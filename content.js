const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function obterIdDaConta() {
  const html = document.documentElement.innerHTML.replace(/\\"/g, '"');
  const encontrado = html.match(/"viewerId":"(\d+)"/i)
    || html.match(/"appScopedIdentity":"(\d+)"/i);
  if (encontrado) return encontrado[1];

  return document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/)?.[1] || null;
}

function obterUsuarioDoPerfilAberto() {
  const usuario = location.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  if (!usuario || ['accounts', 'explore', 'reels', 'direct'].includes(usuario)) return null;
  return usuario;
}

function cabecalhosInstagram() {
  const html = document.documentElement.innerHTML.replace(/\\"/g, '"');
  const csrfDoHtml = html.match(/"csrf_token":"([^"]+)"/i)?.[1];
  const appId = html.match(/"X-IG-App-ID":"([^"]+)"/i)?.[1];
  const headers = {
    'x-asbd-id': '359341',
    'x-ig-max-touch-points': '0',
    'x-requested-with': 'XMLHttpRequest'
  };
  const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
  const claim = sessionStorage.getItem('www-claim-v2');

  if (csrfDoHtml || csrf) headers['x-csrftoken'] = csrfDoHtml || decodeURIComponent(csrf);
  if (appId) headers['x-ig-app-id'] = appId;
  if (claim) headers['x-ig-www-claim'] = claim;
  return headers;
}

function enviarProgresso(lista, lidos) {
  chrome.runtime.sendMessage({ tipo: 'PROGRESSO', lista, lidos }).catch(() => {});
}

async function buscarPagina(url) {
  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    const resposta = await fetch(url, {
      credentials: 'include',
      headers: cabecalhosInstagram()
    });

    if (resposta.status === 429 && tentativa < 3) {
      const segundos = tentativa * 45;
      chrome.runtime.sendMessage({
        tipo: 'AGUARDANDO',
        texto: `O Instagram pediu uma pausa. Tentando novamente em ${segundos}s...`
      }).catch(() => {});
      await esperar(segundos * 1000);
      continue;
    }
    if (resposta.status === 401 || resposta.status === 403) {
      throw new Error('O Instagram recusou a leitura. Atualize a página, confirme o login e tente novamente.');
    }
    if (resposta.status === 429) {
      throw new Error('O Instagram continuou limitando as consultas após as tentativas automáticas. Aguarde alguns minutos e tente novamente.');
    }
    if (!resposta.ok) {
      const detalhe = (await resposta.text()).replace(/\s+/g, ' ').slice(0, 140);
      throw new Error(
        `O Instagram não respondeu a lista (erro ${resposta.status}).` +
        (detalhe ? ` Detalhe: ${detalhe}` : '')
      );
    }

    return resposta.json();
  }

  throw new Error('Não foi possível carregar a lista do Instagram.');
}

async function obterPerfilAberto(usuario) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(usuario)}`;
  const dados = await buscarPagina(url);
  const perfil = dados.data?.user || dados.user;
  const id = String(perfil?.id ?? perfil?.pk ?? '');

  if (!id) throw new Error('Não consegui identificar o perfil aberto. Atualize a página do perfil e tente novamente.');
  return {
    id,
    usuario: String(perfil.username || usuario).toLowerCase(),
    seguidores: Number(perfil.follower_count),
    seguindo: Number(perfil.following_count)
  };
}

async function carregarLista(idConta, lista, idDoPerfil) {
  const usuarios = new Map();
  const cursoresUsados = new Set();
  let cursor = '';

  while (true) {
    let url = `https://www.instagram.com/api/v1/friendships/${idConta}/${lista}/?count=50`;
    url += lista === 'followers'
      ? '&search_surface=follow_list_page'
      : '&order=date_followed_latest';
    if (cursor) url += `&max_id=${encodeURIComponent(cursor)}`;

    const dados = await buscarPagina(url);
    if (!Array.isArray(dados.users)) {
      throw new Error('O Instagram não retornou a lista esperada. Atualize a página e tente novamente.');
    }
    dados.users.forEach((perfil) => {
      const id = String(perfil.pk ?? perfil.pk_id ?? perfil.id ?? '');
      const usuario = String(perfil.username ?? '').trim().toLowerCase();
      if (id && usuario && id !== idDoPerfil) usuarios.set(id, usuario);
    });
    enviarProgresso(lista === 'followers' ? 'seguidores' : 'seguindo', usuarios.size);

    const proximoCursor = dados.next_max_id == null ? '' : String(dados.next_max_id);
    if (!proximoCursor || !dados.users.length || cursoresUsados.has(proximoCursor)) break;

    cursoresUsados.add(proximoCursor);
    cursor = proximoCursor;
    await esperar(1200 + Math.floor(Math.random() * 900));
  }

  return usuarios;
}

chrome.runtime.onMessage.addListener((mensagem, _remetente, responder) => {
  if (mensagem.tipo !== 'ANALISAR_CONTA') return;

  (async () => {
    try {
      const usuarioAberto = obterUsuarioDoPerfilAberto();
      if (!usuarioAberto) throw new Error('Abra um perfil do Instagram antes de iniciar a análise.');

      const perfil = await obterPerfilAberto(usuarioAberto);
      const seguidores = await carregarLista(perfil.id, 'followers', perfil.id);
      const seguindo = await carregarLista(perfil.id, 'following', perfil.id);
      const naoSeguem = [...seguindo.entries()]
        .filter(([id]) => !seguidores.has(id))
        .map(([, usuario]) => usuario)
        .sort();
      const mutuos = [...seguindo.entries()]
        .filter(([id]) => seguidores.has(id))
        .map(([, usuario]) => usuario)
        .sort();

      responder({
        sucesso: true,
        dados: {
          seguidores: [...seguidores.values()].sort(),
          seguindo: [...seguindo.values()].sort(),
          totalSeguidores: Number.isFinite(perfil.seguidores) ? perfil.seguidores : seguidores.size,
          totalSeguindo: Number.isFinite(perfil.seguindo) ? perfil.seguindo : seguindo.size,
          naoSeguem,
          mutuos
        }
      });
    } catch (erro) {
      responder({ sucesso: false, erro: erro.message });
    }
  })();

  return true;
});
