function executarAcaoTikTok(acao, itens) {
  const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const obterContexto = () => {
    let dados = window.__$UNIVERSAL_DATA$__ || null;
    if (!dados?.__DEFAULT_SCOPE__) {
      const texto = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent;
      if (texto) {
        try { dados = JSON.parse(texto); } catch (_) { /* tratado abaixo */ }
      }
    }
    const contexto = dados?.__DEFAULT_SCOPE__?.['webapp.app-context'];
    const secUid = contexto?.user?.secUid || contexto?.userInfo?.user?.secUid || contexto?.secUid;
    if (!secUid) throw new Error('O TikTok não disponibilizou sua conta nesta página. Atualize o site estando logado e tente novamente.');
    return {
      secUid: String(secUid),
      csrfToken: String(contexto?.csrfToken || ''),
      userAgent: String(contexto?.userAgent || navigator.userAgent || ''),
      odinId: String(contexto?.odinId || ''),
      deviceId: String(contexto?.wid || contexto?.encryptedWebid || ''),
      region: String(contexto?.region || ''),
      language: String(contexto?.language || navigator.language || 'pt-BR')
    };
  };

  const temMais = (valor) => valor === true || valor === 1 || valor === '1' || valor === 'true';
  const transformar = (video) => ({
    id: String(video?.id ?? video?.aweme_id ?? ''),
    usuario: String(video?.author?.uniqueId ?? video?.author?.unique_id ?? video?.author?.nickname ?? '').trim(),
    descricao: String(video?.desc ?? '').trim()
  });

  const listar = async (tipo) => {
    const contexto = obterContexto();
    const videos = new Map();
    const cursores = new Set();
    let cursor = '0';
    let pagina = 0;
    let paginasSemNovos = 0;
    const rota = tipo === 'CURTIDOS' ? 'favorite/item_list' : 'repost/item_list';

    while (true) {
      if (cursores.has(cursor) || pagina >= 1000) {
        throw new Error('O TikTok repetiu a paginação antes de terminar a lista. Atualize a página e tente novamente.');
      }
      cursores.add(cursor);
      const parametros = new URLSearchParams({
        aid: '1988',
        count: '30',
        coverFormat: '2',
        cursor,
        needPinnedItemIds: 'true',
        post_item_list_request_type: '0',
        secUid: contexto.secUid
      });
      const resposta = await fetch(`https://www.tiktok.com/api/${rota}/?${parametros}`, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: '*/*' }
      });
      if (resposta.status === 429) throw new Error('O TikTok pediu uma pausa. Aguarde alguns minutos antes de tentar novamente.');
      if (resposta.status === 401 || resposta.status === 403) throw new Error('O TikTok recusou a sessão. Atualize a página e confirme o login.');
      if (!resposta.ok) throw new Error(`O TikTok não respondeu à lista (erro ${resposta.status}).`);

      let dados;
      try { dados = JSON.parse(await resposta.text()); } catch (_) { throw new Error('O TikTok retornou uma resposta inesperada. Atualize a página e tente novamente.'); }
      if (dados.status_code != null && Number(dados.status_code) !== 0) {
        throw new Error(dados.status_msg || 'O TikTok não liberou esta lista.');
      }
      const lista = Array.isArray(dados.itemList) ? dados.itemList : (Array.isArray(dados.item_list) ? dados.item_list : []);
      const totalAntes = videos.size;
      lista.map(transformar).forEach((video) => { if (video.id) videos.set(video.id, video); });
      paginasSemNovos = videos.size === totalAntes ? paginasSemNovos + 1 : 0;

      const proximoCursor = dados.cursor == null ? '' : String(dados.cursor);
      if (!temMais(dados.hasMore ?? dados.has_more) || !lista.length || paginasSemNovos >= 3) break;
      if (!proximoCursor) throw new Error('O TikTok não informou a próxima página da lista. Atualize o site e tente novamente.');
      cursor = proximoCursor;
      pagina += 1;
      await pausa(850);
    }
    return { itens: [...videos.values()] };
  };

  const remover = async (tipo, lista) => {
    const contexto = obterContexto();
    if (!contexto.csrfToken) throw new Error('O TikTok não disponibilizou a sessão. Atualize o site e tente novamente.');
    const unicos = new Map();
    (Array.isArray(lista) ? lista : []).forEach((item) => {
      if (item?.id) unicos.set(String(item.id), { id: String(item.id), usuario: String(item.usuario || '') });
    });

    let removidos = 0;
    const removidosIds = [];
    const erros = [];
    for (const video of unicos.values()) {
      try {
        const parametros = new URLSearchParams(tipo === 'CURTIDOS'
          ? {
            aid: '1988', app_language: contexto.language, app_name: 'tiktok_web', aweme_id: video.id,
            browser_language: navigator.language || contexto.language, browser_name: 'Mozilla', browser_online: 'true',
            browser_platform: navigator.platform || 'Win32', browser_version: contexto.userAgent, channel: 'tiktok_web',
            cookie_enabled: 'true', data_collection_enabled: 'true', device_platform: 'web_pc', focus_state: 'true',
            from_page: 'video', history_len: '2', is_fullscreen: 'false', is_page_visible: 'true', odinId: contexto.odinId,
            os: 'windows', priority_region: contexto.region, referer: '', region: contexto.region,
            screen_height: String(window.screen?.height || 864), screen_width: String(window.screen?.width || 1536),
            type: '0', tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', user_is_login: 'true',
            webcast_language: contexto.language
          }
          : { aid: '1988', item_id: video.id });
        if (tipo === 'CURTIDOS' && contexto.deviceId) parametros.set('device_id', contexto.deviceId);
        if (tipo === 'CURTIDOS') {
          const verifyFp = document.cookie.match(/(?:^|;\s*)s_v_web_id=([^;]+)/)?.[1];
          const msToken = document.cookie.match(/(?:^|;\s*)msToken=([^;]+)/)?.[1];
          if (verifyFp) parametros.set('verifyFp', verifyFp);
          if (msToken) parametros.set('msToken', msToken);
        }
        const rota = tipo === 'CURTIDOS' ? 'api/commit/item/digg/' : 'tiktok/v1/upvote/delete';
        const resposta = await fetch(`https://www.tiktok.com/${rota}?${parametros}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: '*/*',
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'tt-csrf-token': contexto.csrfToken
          },
          body: ''
        });
        if (resposta.status === 429) throw new Error('O TikTok pediu uma pausa. Aguarde alguns minutos antes de continuar.');
        if (!resposta.ok) throw new Error(`O TikTok respondeu com erro ${resposta.status}.`);

        const texto = await resposta.text();
        if (texto.trim()) {
          let dados;
          try { dados = JSON.parse(texto); } catch (_) { throw new Error('O TikTok retornou uma resposta inesperada.'); }
          if (dados.status_code != null && Number(dados.status_code) !== 0) {
            throw new Error(dados.status_msg || 'O TikTok não confirmou a remoção.');
          }
        }
        removidos += 1;
        removidosIds.push(video.id);
        await pausa(1100);
      } catch (erro) {
        if (String(erro.message).includes('pausa')) throw erro;
        erros.push(video.usuario ? `@${video.usuario}: ${erro.message}` : erro.message);
      }
    }
    return { removidos, removidosIds, falhas: erros.length, erros };
  };

  if (acao === 'LISTAR_CURTIDOS') return listar('CURTIDOS');
  if (acao === 'LISTAR_REPOSTS') return listar('REPOSTS');
  if (acao === 'REMOVER_CURTIDOS') return remover('CURTIDOS', itens);
  if (acao === 'REMOVER_REPOSTS') return remover('REPOSTS', itens);
  throw new Error('Ferramenta do TikTok inválida.');
}

function prepararAbaDaListaTikTok(tipo) {
  const seletores = tipo === 'CURTIDOS'
    ? ['[data-e2e="liked-tab"]']
    : ['[data-e2e="repost-tab"]', '[data-e2e="reposts-tab"]', '[data-e2e="reposted-tab"]'];
  const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  return (async () => {
    for (let tentativa = 0; tentativa < 8; tentativa += 1) {
      const aba = seletores.map((seletor) => document.querySelector(seletor)).find(Boolean);
      if (aba) {
        if (aba.getAttribute('aria-selected') !== 'true') aba.click();
        for (let espera = 0; espera < 8; espera += 1) {
          if (aba.getAttribute('aria-selected') === 'true') return true;
          await pausa(150);
        }
      }
      await pausa(250);
    }
    return false;
  })();
}

function carregarPaginaTikTok(tipo, cursor) {
  const obterContexto = () => {
    let dados = window.__$UNIVERSAL_DATA$__ || null;
    if (!dados?.__DEFAULT_SCOPE__) {
      const texto = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent;
      if (texto) dados = JSON.parse(texto);
    }
    const contexto = dados?.__DEFAULT_SCOPE__?.['webapp.app-context'];
    const secUid = contexto?.user?.secUid || contexto?.userInfo?.user?.secUid || contexto?.secUid;
    if (!secUid) throw new Error('O TikTok não disponibilizou sua conta nesta página. Atualize o site estando logado e tente novamente.');
    return String(secUid);
  };

  return (async () => {
    const secUid = obterContexto();
    const parametros = new URLSearchParams({
      aid: '1988',
      count: '30',
      coverFormat: '2',
      cursor: String(cursor),
      needPinnedItemIds: 'true',
      post_item_list_request_type: '0',
      secUid
    });
    const rota = tipo === 'CURTIDOS' ? 'favorite/item_list' : 'repost/item_list';
    const resposta = await fetch(`https://www.tiktok.com/api/${rota}/?${parametros}`, {
      method: 'GET', credentials: 'same-origin', headers: { accept: '*/*' }
    });
    if (resposta.status === 429) throw new Error('O TikTok pediu uma pausa. Aguarde alguns minutos antes de tentar novamente.');
    if (resposta.status === 401 || resposta.status === 403) throw new Error('O TikTok recusou a sessão. Atualize a página e confirme o login.');
    if (!resposta.ok) throw new Error(`O TikTok não respondeu à lista (erro ${resposta.status}).`);

    const dados = JSON.parse(await resposta.text());
    if (dados.status_code != null && Number(dados.status_code) !== 0) {
      throw new Error(dados.status_msg || 'O TikTok não liberou esta lista.');
    }
    const itens = (Array.isArray(dados.itemList) ? dados.itemList : (Array.isArray(dados.item_list) ? dados.item_list : []))
      .map((video) => ({
        id: String(video?.id ?? video?.aweme_id ?? ''),
        usuario: String(video?.author?.uniqueId ?? video?.author?.unique_id ?? video?.author?.nickname ?? '').trim(),
        descricao: String(video?.desc ?? '').trim()
      }))
      .filter((video) => video.id);
    return {
      itens,
      hasMore: dados.hasMore === true || dados.hasMore === 1 || dados.hasMore === '1' || dados.hasMore === 'true' ||
        dados.has_more === true || dados.has_more === 1 || dados.has_more === '1' || dados.has_more === 'true',
      cursor: dados.cursor == null ? '' : String(dados.cursor)
    };
  })();
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listarTikTokPorPaginas(tabId, tipo, limite = null) {
  await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func: prepararAbaDaListaTikTok, args: [tipo]
  });

  const videos = new Map();
  const cursores = new Set();
  let cursor = '0';
  let pagina = 0;
  let paginasSemNovos = 0;
  const titulo = tipo === 'CURTIDOS' ? 'curtidos' : 'repostados';

  while (true) {
    if (cursores.has(cursor) || pagina >= 1000) {
      throw new Error('O TikTok repetiu a paginação antes de terminar a lista. Atualize a página e tente novamente.');
    }
    cursores.add(cursor);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: carregarPaginaTikTok, args: [tipo, cursor]
    });
    const totalAntes = videos.size;
    for (const video of result.itens) {
      videos.set(video.id, video);
      if (limite && videos.size >= limite) break;
    }
    paginasSemNovos = videos.size === totalAntes ? paginasSemNovos + 1 : 0;
    chrome.runtime.sendMessage({
      tipo: 'TIKTOK_PROGRESSO',
      texto: limite ? `Lendo vídeos ${titulo}: ${videos.size}/${limite}.` : `Lendo vídeos ${titulo}: ${videos.size}.`
    }).catch(() => {});

    if ((limite && videos.size >= limite) || !result.hasMore || !result.itens.length || paginasSemNovos >= 3) break;
    if (!result.cursor) throw new Error('O TikTok não informou a próxima página da lista. Atualize o site e tente novamente.');
    cursor = result.cursor;
    pagina += 1;
    await esperar(350);
  }
  return { itens: [...videos.values()].slice(0, limite || undefined) };
}

async function verificarCurtidasRemovidas(tabId, ids) {
  const pendentes = new Set(ids);
  if (!pendentes.size) return [];
  const cursores = new Set();
  let cursor = '0';
  const maxPaginas = Math.max(3, Math.ceil(pendentes.size / 30) + 2);

  for (let pagina = 0; pagina < maxPaginas; pagina += 1) {
    if (cursores.has(cursor)) break;
    cursores.add(cursor);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: carregarPaginaTikTok, args: ['CURTIDOS', cursor]
    });
    result.itens.forEach((video) => pendentes.delete(video.id));
    if (!result.hasMore || !result.itens.length) break;
    if (!result.cursor) break;
    cursor = result.cursor;
    await esperar(250);
  }
  return ids.filter((id) => !pendentes.has(id));
}

chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
  if (mensagem?.tipo !== 'TIKTOK_ACAO') return;
  if (remetente.tab || !Number.isInteger(mensagem.tabId)) {
    responder({ sucesso: false, erro: 'Solicitação inválida.' });
    return;
  }

  (async () => {
    try {
      if (mensagem.acao === 'LISTAR_CURTIDOS' || mensagem.acao === 'LISTAR_REPOSTS') {
        const tipo = mensagem.acao === 'LISTAR_CURTIDOS' ? 'CURTIDOS' : 'REPOSTS';
        const limite = Number.isInteger(Number(mensagem.limite)) && Number(mensagem.limite) > 0
          ? Number(mensagem.limite)
          : null;
        responder({ sucesso: true, ...(await listarTikTokPorPaginas(mensagem.tabId, tipo, limite)) });
      } else {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: mensagem.tabId },
          world: 'MAIN',
          func: executarAcaoTikTok,
          args: [mensagem.acao, mensagem.itens]
        });
        if (mensagem.acao === 'REMOVER_CURTIDOS' && result.removidosIds?.length) {
          const aindaCurtidos = await verificarCurtidasRemovidas(mensagem.tabId, result.removidosIds);
          if (aindaCurtidos.length) {
            const aindaCurtidosSet = new Set(aindaCurtidos);
            result.removidosIds = result.removidosIds.filter((id) => !aindaCurtidosSet.has(id));
            result.removidos = result.removidosIds.length;
            result.falhas += aindaCurtidos.length;
            result.erros.push(`${aindaCurtidos.length} curtida(s) ainda aparecem no TikTok após a confirmação.`);
          }
        }
        responder({ sucesso: true, ...result });
      }
    } catch (erro) {
      responder({ sucesso: false, erro: erro.message || 'Não foi possível concluir a ação no TikTok.' });
    }
  })();
  return true;
});
