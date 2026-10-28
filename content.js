function htmlDaPagina() {
  return document.documentElement.innerHTML;
}

function obterIdDaContaLogada() {
  const html = htmlDaPagina();
  const encontrado = html.match(/\\?"viewerId\\?":\\?"(\d+)\\?"/i)
    || html.match(/"viewerId":"(\d+)"/i)
    || html.match(/\\?"appScopedIdentity\\?":\\?"(\d+)\\?"/i)
    || html.match(/"appScopedIdentity":"(\d+)"/i);
  if (encontrado) return encontrado[1];

  return document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/)?.[1] || null;
}

const ROTAS_QUE_NAO_SAO_PERFIL = new Set([
  '', 'accounts', 'about', 'api', 'challenge', 'developer', 'direct', 'directory',
  'emails', 'explore', 'legal', 'p', 'privacy', 'reel', 'reels', 'stories',
  'terms', 'web', 'your_activity'
]);

function usuarioDoPerfilAberto() {
  const partes = location.pathname.split('/').filter(Boolean);
  if (!partes.length) return '';

  // O Instagram também abre perfis por /_u/usuario.
  const candidato = partes[0] === '_u' ? partes[1] : partes[0];
  if (!candidato || ROTAS_QUE_NAO_SAO_PERFIL.has(candidato.toLowerCase())) return '';
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(candidato)) return '';
  return candidato.toLowerCase();
}

function cabecalhosInstagram() {
  const html = htmlDaPagina();
  const csrfDoHtml = html.match(/"csrf_token":"([^"]+)"/i)?.[1]
    || html.match(/\\?"csrf_token\\?":\\?"([^"]+)\\?"/i)?.[1];
  const appId = html.match(/"X-IG-App-ID":"([^"]+)"/i)?.[1]
    || html.match(/\\?"X-IG-App-ID\\?":\\?"([^"]+)\\?"/i)?.[1];
  const csrfDoCookie = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
  const claim = sessionStorage.getItem('www-claim-v2');
  const headers = {
    'x-asbd-id': '359341',
    'x-ig-max-touch-points': '0',
    'x-requested-with': 'XMLHttpRequest'
  };

  if (csrfDoHtml || csrfDoCookie) headers['x-csrftoken'] = csrfDoHtml || decodeURIComponent(csrfDoCookie);
  // Nem todas as páginas atuais deixam o ID no HTML. Este é o identificador
  // do cliente web e serve apenas como fallback para as rotas do próprio site.
  headers['x-ig-app-id'] = appId || '936619743392459';
  if (claim) headers['x-ig-www-claim'] = claim;
  return headers;
}

function enviarProgresso(lista, lidos, total = null) {
  chrome.runtime.sendMessage({ tipo: 'PROGRESSO', lista, lidos, total }).catch(() => {});
}

async function consultarInstagram(url) {
  const resposta = await fetch(url, {
    credentials: 'include',
    headers: cabecalhosInstagram()
  });

  if (resposta.status === 401 || resposta.status === 403) {
    const erro = new Error('O Instagram recusou a sessão. Atualize a página, confirme o login e tente novamente.');
    erro.status = resposta.status;
    throw erro;
  }
  if (resposta.status === 429) {
    const erro = new Error('O Instagram limitou temporariamente as consultas. Aguarde alguns minutos antes de tentar novamente.');
    erro.status = resposta.status;
    throw erro;
  }
  if (!resposta.ok) {
    const detalhe = (await resposta.text()).replace(/\s+/g, ' ').slice(0, 140);
    const erro = new Error(`O Instagram não respondeu a lista (erro ${resposta.status}).${detalhe ? ` ${detalhe}` : ''}`);
    erro.status = resposta.status;
    throw erro;
  }

  try {
    return await resposta.json();
  } catch (_) {
    throw new Error('O Instagram retornou uma resposta inesperada. Atualize a página e tente novamente.');
  }
}

function perfilDaResposta(item) {
  const id = String(item?.pk ?? item?.pk_id ?? item?.id ?? '');
  const usuario = String(item?.username ?? '').trim().toLowerCase();
  return id && usuario ? { id, usuario } : null;
}

async function obterPerfilPorUsuario(usuario) {
  if (!usuario) return null;
  const dados = await consultarInstagram(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(usuario)}`
  );
  const conta = dados.data?.user || dados.user;
  const id = String(conta?.id ?? conta?.pk ?? '');
  if (!id) throw new Error(`Não consegui identificar o perfil @${usuario}. Atualize a página e tente novamente.`);
  return {
    id,
    usuario: String(conta.username || usuario).trim().toLowerCase(),
    seguidores: Number.isFinite(Number(conta.edge_followed_by?.count ?? conta.follower_count))
      ? Number(conta.edge_followed_by?.count ?? conta.follower_count)
      : null,
    seguindo: Number.isFinite(Number(conta.edge_follow?.count ?? conta.following_count))
      ? Number(conta.edge_follow?.count ?? conta.following_count)
      : null,
    privado: Boolean(conta.is_private),
    seguidoPelaConta: Boolean(conta.followed_by_viewer)
  };
}

async function resolverPerfilAlvo() {
  const usuarioAberto = usuarioDoPerfilAberto();
  if (usuarioAberto) return obterPerfilPorUsuario(usuarioAberto);

  const idLogado = obterIdDaContaLogada();
  if (!idLogado) {
    throw new Error('Não identifiquei um perfil. Abra o perfil que deseja analisar no Instagram e tente novamente.');
  }
  const resumo = await obterResumoDaConta(idLogado);
  return { id: idLogado, ...resumo, privado: false, seguidoPelaConta: true };
}

async function obterResumoDaConta(idConta) {
  let dados;
  try {
    dados = await consultarInstagram(`https://www.instagram.com/api/v1/users/${encodeURIComponent(idConta)}/info/`);
  } catch (erro) {
    // Em algumas sessões o resumo retorna 400, mas as listas continuam
    // disponíveis. Nesse caso, seguimos usando o total lido das próprias listas.
    if (erro.status === 400) return { usuario: '', seguidores: null, seguindo: null };
    throw erro;
  }
  const conta = dados.user || dados.data?.user;
  if (!conta) throw new Error('Não consegui carregar os dados da conta conectada. Atualize o Instagram e tente novamente.');
  return {
    usuario: String(conta.username || '').toLowerCase(),
    seguidores: Number.isFinite(Number(conta.follower_count)) ? Number(conta.follower_count) : null,
    seguindo: Number.isFinite(Number(conta.following_count)) ? Number(conta.following_count) : null
  };
}

async function carregarListaDaConta(idConta, tipo, totalEsperado = null, limite = null) {
  const usuarios = new Map();
  const cursoresUsados = new Set();
  let cursor = '';

  while (true) {
    let url = `https://www.instagram.com/api/v1/friendships/${encodeURIComponent(idConta)}/${tipo}/?count=100`;
    url += tipo === 'followers'
      ? '&search_surface=follow_list_page'
      : '&order=date_followed_latest';
    if (cursor) url += `&max_id=${encodeURIComponent(cursor)}`;

    const dados = await consultarInstagram(url);
    if (!Array.isArray(dados.users)) {
      throw new Error('O Instagram não retornou a lista esperada. Atualize a página e tente novamente.');
    }

    dados.users.forEach((item) => {
      const perfil = perfilDaResposta(item);
      // O username é o identificador mais consistente entre as duas rotas.
      // Algumas respostas do Instagram representam o mesmo perfil com PKs
      // diferentes, o que gerava falsos positivos na comparação por ID.
      if (perfil) usuarios.set(perfil.usuario, perfil);
    });
    enviarProgresso(tipo === 'followers' ? 'seguidores' : 'seguindo', usuarios.size, limite || totalEsperado);

    if (limite && usuarios.size >= limite) break;

    const proximoCursor = dados.next_max_id == null ? '' : String(dados.next_max_id);
    if (!proximoCursor || !dados.users.length || cursoresUsados.has(proximoCursor)) break;
    cursoresUsados.add(proximoCursor);
    cursor = proximoCursor;
  }

  const lista = [...usuarios.values()];
  // O contador do perfil pode incluir contas desativadas, bloqueadas ou ainda
  // não refletir mudanças recentes. O fim da paginação é a fonte confiável;
  // exigir igualdade com o contador fazia perfis válidos sempre falharem.
  return limite ? lista.slice(0, limite) : lista;
}

async function executarAnalise(tipoMensagem, limite) {
  const resumo = await resolverPerfilAlvo();
  const idConta = resumo.id;
  if (tipoMensagem === 'ULTIMOS_SEGUIDORES') {
    const usuarios = await carregarListaDaConta(idConta, 'followers', resumo.seguidores, limite);
    return { tipo: 'recentes', resumo, usuarios };
  }
  if (tipoMensagem === 'ULTIMOS_SEGUINDO') {
    const usuarios = await carregarListaDaConta(idConta, 'following', resumo.seguindo, limite);
    return { tipo: 'recentes', resumo, usuarios };
  }

  const seguidores = await carregarListaDaConta(idConta, 'followers', resumo.seguidores);
  const seguindo = await carregarListaDaConta(idConta, 'following', resumo.seguindo);
  const seguidoresUsuarios = new Set(seguidores.map((perfil) => perfil.usuario));
  const seguidoresIds = new Set(seguidores.map((perfil) => perfil.id).filter(Boolean));
  const naoSeguem = seguindo
    .filter((perfil) => !seguidoresUsuarios.has(perfil.usuario) && !seguidoresIds.has(perfil.id))
    .map((perfil) => perfil.usuario)
    .sort();

  return {
    tipo: 'comparacao',
    resumo,
    seguidores,
    seguindo,
    naoSeguem
  };
}

chrome.runtime.onMessage.addListener((mensagem, _remetente, responder) => {
  if (!['ANALISAR_CONTA', 'ULTIMOS_SEGUIDORES', 'ULTIMOS_SEGUINDO'].includes(mensagem?.tipo)) return;

  (async () => {
    try {
      const limite = Number.isInteger(Number(mensagem.limite)) && Number(mensagem.limite) > 0
        ? Number(mensagem.limite)
        : 50;
      const resultado = await executarAnalise(mensagem.tipo, limite);

      if (resultado.tipo === 'recentes') {
        responder({ sucesso: true, dados: { perfil: resultado.resumo, usuarios: resultado.usuarios.map((perfil) => perfil.usuario), limite } });
        return;
      }

      responder({
        sucesso: true,
        dados: {
          seguidores: resultado.seguidores.map((perfil) => perfil.usuario),
          seguindo: resultado.seguindo.map((perfil) => perfil.usuario),
          totalSeguidores: resultado.resumo.seguidores ?? resultado.seguidores.length,
          totalSeguindo: resultado.resumo.seguindo ?? resultado.seguindo.length,
          naoSeguem: resultado.naoSeguem,
          perfil: { usuario: resultado.resumo.usuario }
        }
      });
    } catch (erro) {
      responder({ sucesso: false, erro: erro.message || 'Não foi possível consultar o Instagram.' });
    }
  })();

  return true;
});
