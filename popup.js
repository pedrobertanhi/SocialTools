const statusEl = document.querySelector('#status');
const resultadoEl = document.querySelector('#resultado');
const listaEl = document.querySelector('#lista');

const ferramentasTikTok = {
  curtidas: {
    itens: [], analisar: document.querySelector('#tiktok-analisar-curtidas'), remover: document.querySelector('#tiktok-remover-curtidas'),
    singular: 'curtida', plural: 'curtidas', acaoListar: 'LISTAR_CURTIDOS', acaoRemover: 'REMOVER_CURTIDOS'
  },
  reposts: {
    itens: [], analisar: document.querySelector('#tiktok-analisar-reposts'), remover: document.querySelector('#tiktok-remover-reposts'),
    singular: 'repost', plural: 'reposts', acaoListar: 'LISTAR_REPOSTS', acaoRemover: 'REMOVER_REPOSTS'
  }
};

function mostrarStatus(texto) { statusEl.textContent = texto; }

function mostrarResultado({ um, rotuloUm, dois, rotuloDois, tres, rotuloTres, titulo, itens }) {
  document.querySelector('#total-um').textContent = um;
  document.querySelector('#rotulo-um').textContent = rotuloUm;
  document.querySelector('#total-dois').textContent = dois;
  document.querySelector('#rotulo-dois').textContent = rotuloDois;
  document.querySelector('#total-tres').textContent = tres;
  document.querySelector('#rotulo-tres').textContent = rotuloTres;
  document.querySelector('#titulo-lista').textContent = titulo;
  listaEl.innerHTML = '';
  if (!itens.length) listaEl.innerHTML = '<li class="empty">Nenhum item encontrado.</li>';
  else itens.forEach((texto) => {
    const item = document.createElement('li');
    item.textContent = texto;
    listaEl.appendChild(item);
  });
  resultadoEl.classList.remove('hidden');
}

async function abaAtiva(enderecoEsperado) {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!aba?.id || !enderecoEsperado.test(aba.url || '')) {
    throw new Error(`Abra ${enderecoEsperado.source.includes('tiktok') ? 'o TikTok' : 'o Instagram'} em uma aba antes de usar esta ferramenta.`);
  }
  return aba;
}

async function enviarParaAba(aba, mensagem, arquivo) {
  try { return await chrome.tabs.sendMessage(aba.id, mensagem); } catch (erro) {
    if (!String(erro.message || '').includes('Receiving end does not exist')) throw erro;
    await chrome.scripting.executeScript({ target: { tabId: aba.id }, files: [arquivo] });
    return chrome.tabs.sendMessage(aba.id, mensagem);
  }
}

async function executarNoTikTok(aba, acao, itens = [], limite = null) {
  return chrome.runtime.sendMessage({ tipo: 'TIKTOK_ACAO', acao, tabId: aba.id, itens, limite });
}

function setCarregando(botao, carregando, textoOriginal) {
  botao.disabled = carregando;
  botao.textContent = carregando ? 'Analisando...' : textoOriginal;
}

function elementosSelecao(tipo) {
  return {
    botoes: [...document.querySelectorAll(`[data-select-type="${tipo}"]`)],
    custom: document.querySelector(`#custom-${tipo}`),
    input: document.querySelector(`#quantidade-${tipo}`),
    badge: document.querySelector(`#quantidade-${tipo}-badge`)
  };
}

function modoSelecao(tipo) {
  return elementosSelecao(tipo).botoes.find((botao) => botao.classList.contains('active'))?.dataset.mode || 'todos';
}

function quantidadeDefinida(tipo, paraLeitura = false) {
  if (modoSelecao(tipo) === 'todos') return null;
  const quantidade = Number(elementosSelecao(tipo).input.value);
  const total = ferramentasTikTok[tipo].itens.length;
  if (!Number.isInteger(quantidade) || quantidade < 1 || (!paraLeitura && quantidade > total)) {
    throw new Error(paraLeitura ? 'Escolha uma quantidade válida.' : `Escolha uma quantidade entre 1 e ${total}.`);
  }
  return quantidade;
}

function atualizarControle(tipo) {
  const ferramenta = ferramentasTikTok[tipo];
  const elementos = elementosSelecao(tipo);
  const quantidade = ferramenta.itens.length;
  elementos.badge.textContent = quantidade;
  elementos.input.max = '10000';
  elementos.custom.classList.toggle('hidden', modoSelecao(tipo) !== 'quantidade');
  ferramenta.remover.disabled = quantidade === 0;
  ferramenta.remover.textContent = quantidade
    ? `Remover ${quantidade} ${quantidade === 1 ? ferramenta.singular : ferramenta.plural}`
    : `Remover ${ferramenta.plural}`;
}

document.querySelectorAll('.platform').forEach((botao) => {
  botao.addEventListener('click', () => {
    const plataforma = botao.dataset.platform;
    document.querySelectorAll('.platform').forEach((item) => item.classList.toggle('active', item === botao));
    document.querySelector('#instagram-tools').classList.toggle('hidden', plataforma !== 'instagram');
    document.querySelector('#tiktok-tools').classList.toggle('hidden', plataforma !== 'tiktok');
    resultadoEl.classList.add('hidden');
    mostrarStatus(plataforma === 'instagram' ? 'Abra o Instagram conectado e escolha a ferramenta.' : 'Escolha todos ou uma quantidade e inicie a análise.');
  });
});

document.querySelectorAll('.tool-option').forEach((botao) => {
  botao.addEventListener('click', () => {
    const ferramenta = botao.dataset.tiktokTool;
    document.querySelectorAll('.tool-option').forEach((item) => item.classList.toggle('active', item === botao));
    document.querySelector('#tiktok-curtidas-panel').classList.toggle('hidden', ferramenta !== 'curtidas');
    document.querySelector('#tiktok-reposts-panel').classList.toggle('hidden', ferramenta !== 'reposts');
    resultadoEl.classList.add('hidden');
    mostrarStatus(`Escolha todos ou a quantidade de ${ferramenta} que deseja analisar.`);
  });
});

document.querySelectorAll('[data-select-type]').forEach((botao) => {
  botao.addEventListener('click', () => {
    const tipo = botao.dataset.selectType;
    elementosSelecao(tipo).botoes.forEach((item) => item.classList.toggle('active', item === botao));
    atualizarControle(tipo);
    if (botao.dataset.mode === 'quantidade') elementosSelecao(tipo).input.focus();
  });
});

document.querySelectorAll('[data-step]').forEach((botao) => {
  botao.addEventListener('click', () => {
    const tipo = botao.dataset.step;
    const { input } = elementosSelecao(tipo);
    const maximo = Number(input.max) || 10000;
    input.value = String(Math.max(1, Math.min(maximo, (Number(input.value) || 1) + Number(botao.dataset.direction))));
  });
});

['curtidas', 'reposts'].forEach(atualizarControle);

document.querySelector('#insta-nao-seguidores').addEventListener('click', async (evento) => {
  const botao = evento.currentTarget;
  setCarregando(botao, true, 'Quem não segue de volta');
  mostrarStatus('Consultando seguidores e seguindo da conta conectada...');
  try {
    const aba = await abaAtiva(/^https:\/\/(www\.)?instagram\.com\//i);
    const resposta = await enviarParaAba(aba, { tipo: 'ANALISAR_CONTA' }, 'content.js');
    if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível analisar o perfil.');
    const dados = resposta.dados;
    mostrarResultado({
      um: dados.totalSeguindo, rotuloUm: 'Você segue', dois: dados.totalSeguidores, rotuloDois: 'Te seguem',
      tres: dados.naoSeguem.length, rotuloTres: 'Não seguem de volta',
      titulo: 'Perfis que não seguem você de volta', itens: dados.naoSeguem.map((perfil) => `@${perfil}`)
    });
    mostrarStatus(`Análise concluída: ${dados.naoSeguem.length} perfil(is) não seguem você de volta.`);
  } catch (erro) { mostrarStatus(erro.message || 'Não foi possível analisar o perfil.'); }
  finally { setCarregando(botao, false, 'Quem não segue de volta'); }
});

async function listarRecentesInstagram(tipo) {
  const seguidores = tipo === 'seguidores';
  const botao = document.querySelector(seguidores ? '#insta-ultimos-seguidores' : '#insta-ultimos-seguindo');
  const textoOriginal = seguidores ? 'Últimos seguidores' : 'Últimos seguindo';
  const acao = seguidores ? 'ULTIMOS_SEGUIDORES' : 'ULTIMOS_SEGUINDO';
  const rotuloTotal = seguidores ? 'Seguidores' : 'Seguindo';
  const titulo = seguidores ? 'Últimos seguidores' : 'Últimos perfis seguidos';

  setCarregando(botao, true, textoOriginal);
  mostrarStatus(`Consultando os 50 primeiros ${tipo} da conta conectada...`);
  try {
    const aba = await abaAtiva(/^https:\/\/(www\.)?instagram\.com\//i);
    const resposta = await enviarParaAba(aba, { tipo: acao, limite: 50 }, 'content.js');
    if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível ler esta lista.');
    const dados = resposta.dados;
    const usuarios = Array.isArray(dados.usuarios) ? dados.usuarios : [];
    const total = seguidores ? dados.perfil?.seguidores : dados.perfil?.seguindo;
    mostrarResultado({
      um: Number.isFinite(total) ? total : usuarios.length, rotuloUm: rotuloTotal,
      dois: usuarios.length, rotuloDois: 'Perfis exibidos', tres: 50, rotuloTres: 'Máximo desta consulta',
      titulo: `${titulo} de @${dados.perfil?.usuario || 'perfil'}`,
      itens: usuarios.map((usuario) => `@${usuario}`)
    });
    mostrarStatus(`${usuarios.length} perfil(is) exibido(s) na ordem apresentada pelo Instagram.`);
  } catch (erro) {
    mostrarStatus(erro.message || 'Não foi possível ler esta lista.');
  } finally {
    setCarregando(botao, false, textoOriginal);
  }
}

document.querySelector('#insta-ultimos-seguidores').addEventListener('click', () => listarRecentesInstagram('seguidores'));
document.querySelector('#insta-ultimos-seguindo').addEventListener('click', () => listarRecentesInstagram('seguindo'));

async function analisarTikTok(tipo) {
  const ferramenta = ferramentasTikTok[tipo];
  let limite;
  try { limite = quantidadeDefinida(tipo, true); } catch (erro) { mostrarStatus(erro.message); return; }
  ferramenta.itens = [];
  atualizarControle(tipo);
  setCarregando(ferramenta.analisar, true, `Analisar vídeos ${tipo}`);
  mostrarStatus(limite ? `Lendo até ${limite} vídeos ${tipo}...` : `Lendo todos os vídeos ${tipo}...`);
  try {
    const aba = await abaAtiva(/^https:\/\/(www\.)?tiktok\.com\//i);
    const resposta = await executarNoTikTok(aba, ferramenta.acaoListar, [], limite);
    if (!resposta?.sucesso) throw new Error(resposta?.erro || `Não foi possível ler seus ${tipo}.`);
    ferramenta.itens = Array.isArray(resposta.itens) ? resposta.itens : [];
    atualizarControle(tipo);
    mostrarResultado({
      um: ferramenta.itens.length, rotuloUm: `Vídeos ${tipo}`, dois: 0, rotuloDois: 'Ações feitas', tres: 0, rotuloTres: 'Erros',
      titulo: `Vídeos ${tipo} encontrados`, itens: ferramenta.itens.slice(0, 100).map((item) => item.usuario ? `@${item.usuario}` : 'Vídeo sem autor identificado')
    });
    mostrarStatus(`${ferramenta.itens.length} vídeo(s) encontrado(s).`);
  } catch (erro) { mostrarStatus(erro.message || `Não foi possível ler seus ${tipo}.`); }
  finally { setCarregando(ferramenta.analisar, false, `Analisar vídeos ${tipo}`); }
}

async function removerTikTok(tipo) {
  const ferramenta = ferramentasTikTok[tipo];
  if (!ferramenta.itens.length) return;
  const quantidade = ferramenta.itens.length;
  if (!window.confirm(`Remover ${quantidade} ${quantidade === 1 ? ferramenta.singular : ferramenta.plural}?`)) return;
  try {
    ferramenta.remover.disabled = true;
    ferramenta.remover.textContent = 'Removendo...';
    mostrarStatus(`Removendo ${quantidade} ${ferramenta.plural}, um por vez...`);
    const aba = await abaAtiva(/^https:\/\/(www\.)?tiktok\.com\//i);
    const resposta = await executarNoTikTok(aba, ferramenta.acaoRemover, ferramenta.itens);
    if (!resposta?.sucesso) throw new Error(resposta?.erro || `Não foi possível remover os ${tipo}.`);
    const removidos = resposta.removidos || 0;
    const falhas = resposta.falhas || 0;
    const removidosIds = new Set(resposta.removidosIds || []);
    ferramenta.itens = ferramenta.itens.filter((item) => !removidosIds.has(item.id));
    atualizarControle(tipo);
    mostrarResultado({
      um: quantidade, rotuloUm: 'Selecionados', dois: removidos,
      rotuloDois: tipo === 'curtidas' ? 'Curtidas removidas' : 'Reposts removidos',
      tres: falhas, rotuloTres: 'Não removidos', titulo: 'Resultado da remoção', itens: resposta.erros || []
    });
    mostrarStatus(tipo === 'curtidas'
      ? `Concluído: ${removidos} curtida(s) removida(s)${falhas ? `; ${falhas} não foram removidas.` : '.'}`
      : `Concluído: ${removidos} repost(s) removido(s)${falhas ? `; ${falhas} não foram removidos.` : '.'}`);
  } catch (erro) { mostrarStatus(erro.message || `Não foi possível remover os ${tipo}.`); }
  finally { atualizarControle(tipo); }
}

ferramentasTikTok.curtidas.analisar.addEventListener('click', () => analisarTikTok('curtidas'));
ferramentasTikTok.reposts.analisar.addEventListener('click', () => analisarTikTok('reposts'));
ferramentasTikTok.curtidas.remover.addEventListener('click', () => removerTikTok('curtidas'));
ferramentasTikTok.reposts.remover.addEventListener('click', () => removerTikTok('reposts'));

chrome.runtime.onMessage.addListener((mensagem) => {
  if (mensagem.tipo === 'PROGRESSO') {
    const total = mensagem.total ? `/${mensagem.total}` : '';
    mostrarStatus(`Lendo ${mensagem.lista}: ${mensagem.lidos}${total} perfis.`);
  }
  if (mensagem.tipo === 'AGUARDANDO' || mensagem.tipo === 'TIKTOK_PROGRESSO') mostrarStatus(mensagem.texto);
});
