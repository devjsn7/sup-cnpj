// index.js
// SupCnpj — Agrega múltiplas APIs públicas de CNPJ em uma única resposta unificada
// Node.js + Express

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ============================================================
// CACHE (TTL 15 min)
// ============================================================
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

const getCache = (k) => {
  const it = cache.get(k);
  if (!it) return null;
  if (Date.now() - it.ts > CACHE_TTL) return cache.delete(k), null;
  return it.data;
};
const setCache = (k, d) => cache.set(k, { data: d, ts: Date.now() });

// ============================================================
// CNPJ — utilidades
// ============================================================
const limparCNPJ = (c) => String(c || '').replace(/\D/g, '');

function validarCNPJ(cnpj) {
  cnpj = limparCNPJ(cnpj);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (base) => {
    let soma = 0, pos = base.length - 7;
    for (let i = base.length; i >= 1; i--) {
      soma += parseInt(base[base.length - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const base = cnpj.slice(0, 12);
  const d1 = calc(base);
  const d2 = calc(base + d1);
  return cnpj === base + d1 + d2;
}

const formatarCNPJ = (c) =>
  limparCNPJ(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const formatarCNAE = (c) => {
  if (!c) return null;
  const x = String(c).replace(/\D/g, '').padStart(7, '0');
  return `${x.slice(0, 4)}-${x.slice(4, 5)}/${x.slice(5, 7)}`;
};

const formatarCEP = (cep) => {
  if (!cep) return null;
  const c = String(cep).replace(/\D/g, '');
  return c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : cep;
};

const formatarTelefone = (ddd, tel) => {
  if (!tel) return null;
  const d = String(ddd || '').replace(/\D/g, '');
  let t = String(tel).replace(/\D/g, '');
  if (d && t.startsWith(d)) t = t.slice(d.length);
  if (t.length === 8) return d ? `(${d}) ${t.slice(0, 4)}-${t.slice(4)}` : t;
  if (t.length === 9) return d ? `(${d}) ${t.slice(0, 5)}-${t.slice(5)}` : t;
  if (t.length === 10) return `(${t.slice(0, 2)}) ${t.slice(2, 6)}-${t.slice(6)}`;
  if (t.length === 11) return `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}`;
  return t;
};

const numero = (x) => {
  if (x === null || x === undefined || x === '') return null;
  const n = typeof x === 'string' ? parseFloat(x.replace(',', '.')) : Number(x);
  return Number.isFinite(n) ? n : null;
};

const v = (...xs) => {
  for (const x of xs) {
    if (x === undefined || x === null || x === '') continue;
    if (Array.isArray(x) && x.length === 0) continue;
    return x;
  }
  return null;
};

const limpar = (obj) => {
  if (Array.isArray(obj)) {
    const arr = obj.map(limpar).filter((x) => x !== null && x !== undefined);
    return arr.length ? arr : null;
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(obj)) {
      const c = limpar(val);
      if (c !== null && c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : null;
  }
  if (obj === '' || obj === null || obj === undefined) return null;
  return obj;
};

// ============================================================
// CONSULTAS — APIs PÚBLICAS (paralelo)
// ============================================================
const UA = { 'User-Agent': 'SupCnpj/4.0 (agregador)', Accept: 'application/json' };

async function apiBrasilAPI(cnpj) {
  const { data } = await axios.get(
    `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
    { timeout: 20000, headers: UA }
  );
  return data;
}

async function apiReceitaWS(cnpj) {
  const { data } = await axios.get(
    `https://receitaws.com.br/v1/cnpj/${cnpj}`,
    { timeout: 20000, headers: UA }
  );
  if (data.status === 'ERROR') throw new Error(data.message || 'ReceitaWS erro');
  return data;
}

async function apiMinhaReceita(cnpj) {
  const { data } = await axios.get(
    `https://minhareceita.org/${cnpj}`,
    { timeout: 20000, headers: UA }
  );
  return data;
}

async function apiCnpjWs(cnpj) {
  const { data } = await axios.get(
    `https://publica.cnpj.ws/cnpj/${cnpj}`,
    { timeout: 20000, headers: UA }
  );
  return data;
}

async function apiOpenCnpj(cnpj) {
  const { data } = await axios.get(
    `https://api.opencnpj.org/${cnpj}`,
    { timeout: 20000, headers: UA }
  );
  return data;
}

async function apiCnpja(cnpj) {
  const { data } = await axios.get(
    `https://open.cnpja.com/office/${cnpj}`,
    { timeout: 20000, headers: UA }
  );
  return data;
}

async function todasFontes(cnpj) {
  const safe = async (fn) => { try { return { ok: true, data: await fn(cnpj) }; } catch (e) { return { ok: false, err: e.message }; } };
  const [brasilapi, receitaws, minhareceita, cnpjws, opencnpj, cnpja] = await Promise.all([
    safe(apiBrasilAPI),
    safe(apiReceitaWS),
    safe(apiMinhaReceita),
    safe(apiCnpjWs),
    safe(apiOpenCnpj),
    safe(apiCnpja),
  ]);
  return { brasilapi, receitaws, minhareceita, cnpjws, opencnpj, cnpja };
}

// ============================================================
// AGREGAÇÃO — apenas dados reais das fontes
// ============================================================
function agregar(cnpj, f) {
  const B = f.brasilapi.ok ? f.brasilapi.data : {};
  const R = f.receitaws.ok ? f.receitaws.data : {};
  const M = f.minhareceita.ok ? f.minhareceita.data : {};
  const W = f.cnpjws.ok ? f.cnpjws.data : {};
  const O = f.opencnpj.ok ? f.opencnpj.data : {};
  const A = f.cnpja.ok ? f.cnpja.data : {};

  const est = W.estabelecimento || {};
  const empresa = W.empresa || {};

  // --- Identificação ---
  const razaoSocial = v(B.razao_social, M.razao_social, R.nome, O.razao_social, A.company?.name, empresa.razao_social);
  const nomeFantasia = v(B.nome_fantasia, M.nome_fantasia, R.fantasia, O.nome_fantasia, A.alias, est.nome_fantasia);

  const identificadorMatrizFilial = numero(v(B.identificador_matriz_filial, M.identificador_matriz_filial));
  const tipo = v(
    B.descricao_identificador_matriz_filial,
    M.descricao_identificador_matriz_filial,
    R.tipo,
    est.tipo,
    identificadorMatrizFilial === 1 ? 'MATRIZ' : identificadorMatrizFilial === 2 ? 'FILIAL' : null
  );

  const porte = v(B.porte, M.porte, R.porte, A.company?.size?.text, empresa.porte?.descricao, O.porte, est.porte?.descricao);
  const naturezaJuridica = v(B.natureza_juridica, M.natureza_juridica, R.natureza_juridica, A.company?.nature?.text, empresa.natureza_juridica?.descricao, O.natureza_juridica);

  const dataAbertura = v(B.data_inicio_atividade, M.data_inicio_atividade, R.abertura, A.founded, est.data_inicio_atividade, O.data_inicio_atividade);

  const capitalSocialNum = numero(v(B.capital_social, M.capital_social, R.capital_social, A.company?.equity, est.capital_social, O.capital_social));

  // --- Contato ---
  const email = v(B.email, M.email, R.email, A.emails?.[0]?.address, est.email, O.email);
  const telefone1 = formatarTelefone(v(B.ddd_telefone_1, M.ddd_telefone_1, est.ddd1, O.ddd_telefone_1), v(B.ddd_telefone_1, M.ddd_telefone_1, est.telefone1, O.ddd_telefone_1, R.telefone));
  const telefone2 = formatarTelefone(v(B.ddd_telefone_2, M.ddd_telefone_2, est.ddd2, O.ddd_telefone_2), v(B.ddd_telefone_2, M.ddd_telefone_2, est.telefone2, O.ddd_telefone_2));
  const fax = formatarTelefone(v(B.ddd_fax, M.ddd_fax, est.ddd_fax), v(B.ddd_fax, M.ddd_fax, est.fax));

  // --- Endereço ---
  const endereco = {
    tipoLogradouro: v(B.descricao_tipo_de_logradouro, M.descricao_tipo_de_logradouro, est.tipo_logradouro),
    logradouro: v(B.logradouro, M.logradouro, R.logradouro, A.address?.street, est.logradouro, O.logradouro),
    numero: v(B.numero, M.numero, R.numero, A.address?.number, est.numero, O.numero),
    complemento: v(B.complemento, M.complemento, R.complemento, A.address?.details, est.complemento, O.complemento),
    bairro: v(B.bairro, M.bairro, R.bairro, A.address?.district, est.bairro, O.bairro),
    cep: formatarCEP(v(B.cep, M.cep, R.cep, A.address?.zip, est.cep, O.cep)),
    municipio: v(B.municipio, M.municipio, R.municipio, A.address?.city, est.cidade?.nome, O.municipio),
    uf: v(B.uf, M.uf, R.uf, A.address?.state, est.estado?.sigla, O.uf),
    pais: v(B.pais, M.pais, est.pais?.nome, A.address?.country?.name, O.pais),
    codigoMunicipioIbge: v(B.codigo_municipio_ibge, M.codigo_municipio_ibge, est.cidade?.ibge_id),
    codigoMunicipio: v(B.codigo_municipio, M.codigo_municipio),
    nomeCidadeNoExterior: v(B.nome_cidade_no_exterior, M.nome_cidade_no_exterior, est.cidade_exterior),
  };

  // --- Atividade principal ---
  const cnaeCod = v(B.cnae_fiscal, M.cnae_fiscal, O.cnae_fiscal, est.atividade_principal?.id, A.mainActivity?.id, R.atividade_principal?.[0]?.code);
  const cnaeDesc = v(B.cnae_fiscal_descricao, M.cnae_fiscal_descricao, O.cnae_fiscal_descricao, est.atividade_principal?.descricao, A.mainActivity?.text, R.atividade_principal?.[0]?.text);

  const atividadePrincipal = cnaeCod || cnaeDesc ? {
    codigo: cnaeCod ? String(cnaeCod) : null,
    codigoFormatado: formatarCNAE(cnaeCod),
    descricao: cnaeDesc,
  } : null;

  // --- Atividades secundárias (merge + dedupe) ---
  const secMap = new Map();
  const pushSec = (cod, desc) => {
    const key = cod ? String(cod) : desc;
    if (!key) return;
    if (!secMap.has(key)) secMap.set(key, { codigo: cod ? String(cod) : null, codigoFormatado: formatarCNAE(cod), descricao: desc || null });
    else {
      const it = secMap.get(key);
      if (!it.descricao && desc) it.descricao = desc;
      if (!it.codigo && cod) { it.codigo = String(cod); it.codigoFormatado = formatarCNAE(cod); }
    }
  };
  (B.cnaes_secundarios || M.cnaes_secundarios || O.cnaes_secundarios || []).forEach((a) => pushSec(a.codigo, a.descricao));
  (est.atividades_secundarias || []).forEach((a) => pushSec(a.id, a.descricao));
  (A.activities || []).forEach((a) => pushSec(a.id, a.text));
  (R.atividades_secundarias || []).forEach((a) => pushSec(a.code, a.text));
  const atividadesSecundarias = [...secMap.values()];

  // --- Situação cadastral ---
  const situacaoDesc = v(B.descricao_situacao_cadastral, M.descricao_situacao_cadastral, O.descricao_situacao_cadastral, R.situacao, A.status?.text, est.situacao_cadastral);
  const dataSituacao = v(B.data_situacao_cadastral, M.data_situacao_cadastral, R.data_situacao, A.statusDate, est.data_situacao_cadastral);
  const motivoSituacao = v(B.descricao_motivo_situacao_cadastral, M.descricao_motivo_situacao_cadastral, O.descricao_motivo_situacao_cadastral, R.motivo_situacao, est.motivo_situacao?.descricao);

  // --- Simples / MEI ---
  const simplesOptante = (() => {
    const cands = [B.opcao_pelo_simples, M.opcao_pelo_simples, R.simples?.optante, W.simples?.simples === 'Sim' ? true : null, A.company?.simples?.optant, O.opcao_pelo_simples];
    for (const c of cands) {
      if (c === true || c === 'Sim') return true;
      if (c === false || c === 'Não') return false;
    }
    return null;
  })();

  const meiOptante = (() => {
    const cands = [B.opcao_pelo_mei, M.opcao_pelo_mei, R.simei?.optante, W.simples?.mei === 'Sim' ? true : null, A.company?.simei?.optant, O.opcao_pelo_mei];
    for (const c of cands) {
      if (c === true || c === 'Sim') return true;
      if (c === false || c === 'Não') return false;
    }
    return null;
  })();

  const simples = {
    optante: simplesOptante,
    dataOpcao: v(B.data_opcao_pelo_simples, M.data_opcao_pelo_simples, R.simples?.data_opcao, W.simples?.data_opcao_simples, A.company?.simples?.since),
    dataExclusao: v(B.data_exclusao_do_simples, M.data_exclusao_do_simples, R.simples?.data_exclusao, W.simples?.data_exclusao_simples, A.company?.simples?.excluded),
    ultimaAtualizacao: v(R.simples?.ultima_atualizacao),
  };
  const simei = {
    optante: meiOptante,
    dataOpcao: v(B.data_opcao_pelo_mei, M.data_opcao_pelo_mei, R.simei?.data_opcao, W.simples?.data_opcao_mei, A.company?.simei?.since),
    dataExclusao: v(B.data_exclusao_do_mei, M.data_exclusao_do_mei, R.simei?.data_exclusao, W.simples?.data_exclusao_mei, A.company?.simei?.excluded),
    ultimaAtualizacao: v(R.simei?.ultima_atualizacao),
  };

  // --- Regime tributário (BrasilAPI) ---
  const regimeTributario = Array.isArray(B.regime_tributario)
    ? B.regime_tributario.map((r) => limpar({
        ano: r.ano,
        formaDeTributacao: r.forma_de_tributacao,
        quantidadeEscrituracoes: r.quantidade_de_escrituracoes,
        cnpjDaScp: r.cnpj_da_scp,
      })).filter(Boolean)
    : [];

  // --- QSA — merge das fontes (apenas dados reais devolvidos pelas APIs) ---
  const sociosMap = new Map();
  const keySocio = (nome, doc) => `${(nome || '').trim().toUpperCase()}|${(doc || '').replace(/\D/g, '')}`;

  const addSocio = (s) => {
    if (!s || !s.nome) return;
    const k = keySocio(s.nome, s.documento);
    const ex = sociosMap.get(k) || {};
    sociosMap.set(k, {
      nome: ex.nome || s.nome,
      documento: ex.documento || s.documento || null,
      tipoPessoa: ex.tipoPessoa || s.tipoPessoa || null,
      qualificacao: ex.qualificacao || s.qualificacao || null,
      codigoQualificacao: ex.codigoQualificacao ?? s.codigoQualificacao ?? null,
      pais: ex.pais || s.pais || null,
      codigoPais: ex.codigoPais ?? s.codigoPais ?? null,
      dataEntrada: ex.dataEntrada || s.dataEntrada || null,
      dataSaida: ex.dataSaida || s.dataSaida || null,
      representanteLegal: ex.representanteLegal || s.representanteLegal || null,
      cpfRepresentanteLegal: ex.cpfRepresentanteLegal || s.cpfRepresentanteLegal || null,
      qualificacaoRepresentanteLegal: ex.qualificacaoRepresentanteLegal || s.qualificacaoRepresentanteLegal || null,
      codigoQualificacaoRepresentanteLegal: ex.codigoQualificacaoRepresentanteLegal ?? s.codigoQualificacaoRepresentanteLegal ?? null,
    });
  };

  // BrasilAPI — dados reais
  (B.qsa || []).forEach((s) => addSocio({
    nome: s.nome_socio,
    documento: s.cnpj_cpf_do_socio || null,
    tipoPessoa: (() => {
      const d = String(s.cnpj_cpf_do_socio || '').replace(/\D/g, '');
      if (d.length === 14) return 'JURÍDICA';
      if (d.length === 11) return 'FÍSICA';
      return null;
    })(),
    qualificacao: s.qualificacao_socio || null,
    codigoQualificacao: s.codigo_qualificacao_socio ?? null,
    pais: s.pais || null,
    codigoPais: s.codigo_pais ?? null,
    dataEntrada: s.data_entrada_sociedade || null,
    representanteLegal: s.nome_representante_legal || null,
    cpfRepresentanteLegal: s.cpf_representante_legal || null,
    qualificacaoRepresentanteLegal: s.qualificacao_representante_legal || null,
    codigoQualificacaoRepresentanteLegal: s.codigo_qualificacao_representante_legal ?? null,
  }));

  // ReceitaWS
  (R.qsa || []).forEach((s) => addSocio({
    nome: s.nome,
    qualificacao: s.qual || null,
    pais: s.pais_origem || null,
    representanteLegal: s.nome_rep_legal || null,
    qualificacaoRepresentanteLegal: s.qual_rep_legal || null,
  }));

  // MinhaReceita / OpenCNPJ
  [...(M.qsa || []), ...(O.qsa || [])].forEach((s) => addSocio({
    nome: v(s.nome_socio, s.nome),
    documento: v(s.cnpj_cpf_do_socio, s.cpf_cnpj),
    qualificacao: v(s.qualificacao_socio, s.qual),
    codigoQualificacao: s.codigo_qualificacao_socio ?? null,
    pais: s.pais ?? null,
    codigoPais: s.codigo_pais ?? null,
    dataEntrada: v(s.data_entrada_sociedade, s.data_entrada),
    representanteLegal: v(s.nome_representante_legal, s.nome_rep_legal),
    cpfRepresentanteLegal: v(s.cpf_representante_legal, s.cpf_rep_legal),
    qualificacaoRepresentanteLegal: v(s.qualificacao_representante_legal, s.qual_rep_legal),
  }));

  // CNPJ.ws
  (W.socios || []).forEach((s) => addSocio({
    nome: s.nome,
    documento: v(s.cpf_cnpj, s.cnpj_cpf_do_socio),
    tipoPessoa: s.tipo === 'Pessoa Jurídica' ? 'JURÍDICA' : s.tipo === 'Pessoa Física' ? 'FÍSICA' : s.tipo,
    qualificacao: v(s.qualificacao_socio?.descricao, s.qualificacao),
    codigoQualificacao: s.qualificacao_socio?.id ?? null,
    pais: v(s.pais?.nome, s.pais),
    codigoPais: s.pais?.id ?? null,
    dataEntrada: s.data_entrada || null,
    dataSaida: s.data_saida || null,
    representanteLegal: s.representante_legal?.nome,
    cpfRepresentanteLegal: s.representante_legal?.cpf,
    qualificacaoRepresentanteLegal: s.representante_legal?.qualificacao,
  }));

  // CNPJA
  (A.people || []).forEach((s) => addSocio({
    nome: s.name,
    documento: v(s.taxId, s.cpf),
    tipoPessoa: s.type === 'NATURAL' ? 'FÍSICA' : s.type === 'LEGAL' ? 'JURÍDICA' : s.type,
    qualificacao: v(s.role?.text, s.qualification),
    pais: v(s.country?.name, s.country),
    dataEntrada: v(s.since, s.data_entrada),
    representanteLegal: s.legalRepresentative?.name,
    cpfRepresentanteLegal: s.legalRepresentative?.taxId,
  }));

  const socios = [...sociosMap.values()];

  // --- Inscrições ---
  const inscricoesEstaduais = [];
  (W.estabelecimento?.inscricoes_estaduais || []).forEach((i) =>
    inscricoesEstaduais.push(limpar({ numero: i.inscricao_estadual, uf: i.estado?.sigla, ativa: i.ativo })));
  if (B.inscricoes_estaduais) (Array.isArray(B.inscricoes_estaduais) ? B.inscricoes_estaduais : [B.inscricoes_estaduais]).forEach((i) =>
    inscricoesEstaduais.push(limpar({ numero: i.inscricao_estadual || i, uf: i.uf, ativa: i.ativo })));
  if (M.inscricoes_estaduais) (Array.isArray(M.inscricoes_estaduais) ? M.inscricoes_estaduais : [M.inscricoes_estaduais]).forEach((i) =>
    inscricoesEstaduais.push(limpar({ numero: i.inscricao_estadual || i, uf: i.uf, ativa: i.ativo })));

  const inscricoesMunicipais = [];
  (W.estabelecimento?.inscricoes_municipais || []).forEach((i) =>
    inscricoesMunicipais.push(limpar({ numero: i.inscricao_municipal, municipio: i.cidade?.nome, uf: i.estado?.sigla, ativa: i.ativo })));

  const inscricoesSuframa = [];
  (W.estabelecimento?.inscricoes_suframa || []).forEach((i) =>
    inscricoesSuframa.push(limpar({ numero: i.inscricao_suframa, ativa: i.ativo })));

  // --- Endereço completo em linha ---
  const enderecoCompleto = [
    [endereco.tipoLogradouro, endereco.logradouro].filter(Boolean).join(' '),
    endereco.numero,
    endereco.complemento,
    endereco.bairro,
    [endereco.municipio, endereco.uf].filter(Boolean).join('/'),
    endereco.cep,
    endereco.pais,
  ].filter(Boolean).join(', ') || null;

  // --- Resposta final ---
  return limpar({
    identificacao: {
      cnpj: formatarCNPJ(cnpj),
      cnpjNumerico: cnpj,
      tipo,
      razaoSocial,
      nomeFantasia,
      naturezaJuridica,
      codigoNaturezaJuridica: v(B.codigo_natureza_juridica, M.codigo_natureza_juridica, empresa.natureza_juridica?.id),
      qualificacaoResponsavel: v(B.qualificacao_do_responsavel, M.qualificacao_do_responsavel),
      porte,
      codigoPorte: v(B.codigo_porte, M.codigo_porte, empresa.porte?.id),
      capitalSocial: capitalSocialNum,
      capitalSocialFormatado: capitalSocialNum !== null
        ? capitalSocialNum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : null,
      dataAbertura,
      efr: R.efr || null,
    },

    situacaoCadastral: {
      descricao: situacaoDesc,
      data: dataSituacao,
      motivo: motivoSituacao,
      codigoMotivo: v(B.motivo_situacao_cadastral, M.motivo_situacao_cadastral),
      situacaoEspecial: v(B.situacao_especial, M.situacao_especial, R.situacao_especial),
      dataSituacaoEspecial: v(B.data_situacao_especial, M.data_situacao_especial, R.data_situacao_especial),
      enteFederativoResponsavel: v(B.ente_federativo_responsavel, M.ente_federativo_responsavel),
    },

    contato: { email, telefone1, telefone2, fax },

    endereco: { ...endereco, completo: enderecoCompleto },

    atividadePrincipal,

    atividadesSecundarias: atividadesSecundarias.length ? atividadesSecundarias : null,
    totalAtividadesSecundarias: atividadesSecundarias.length || null,

    regimeTributario: regimeTributario.length ? regimeTributario : null,

    simplesNacional: (simples.optante !== null || simples.dataOpcao || simples.dataExclusao) ? simples : null,
    simei: (simei.optante !== null || simei.dataOpcao || simei.dataExclusao) ? simei : null,

    inscricoes: (inscricoesEstaduais.length || inscricoesMunicipais.length || inscricoesSuframa.length) ? {
      estaduais: inscricoesEstaduais.length ? inscricoesEstaduais : null,
      municipais: inscricoesMunicipais.length ? inscricoesMunicipais : null,
      suframa: inscricoesSuframa.length ? inscricoesSuframa : null,
    } : null,

    socios: socios.length ? socios : null,

    quadroSocietario: socios.length ? {
      total: socios.length,
      pessoasFisicas: socios.filter((s) => s.tipoPessoa === 'FÍSICA').length,
      pessoasJuridicas: socios.filter((s) => s.tipoPessoa === 'JURÍDICA').length,
    } : null,

    metadados: {
      consultadoEm: new Date().toISOString(),
      ultimaAtualizacao: v(R.ultima_atualizacao, est.atualizado_em, A.updated),
    },
  });
}

// ============================================================
// ROTAS
// ============================================================
app.get('/', (req, res) => {
  res.json({
    api: 'SupCnpj',
    versao: '4.0.0',
    endpoints: {
      'GET /cnpj/:cnpj': 'Consulta completa agregada',
      'GET /cnpj/:cnpj/resumo': 'Resumo',
      'GET /cnpj/:cnpj/socios': 'Quadro societário',
      'GET /cnpj/:cnpj/simples': 'Simples / MEI / Regime tributário',
      'GET /cnpj/:cnpj/atividades': 'CNAE principal + secundárias',
      'GET /cnpj/:cnpj/endereco': 'Endereço',
      'GET /cnpj/:cnpj/inscricoes': 'Inscrições estaduais/municipais/SUFRAMA',
      'GET /cnpj/:cnpj/regime': 'Regime tributário',
    },
    exemplo: '/cnpj/19131243000197',
  });
});

async function consultarComCache(cnpj) {
  const hit = getCache(`v4:${cnpj}`);
  if (hit) return { dados: hit, cache: true };
  const fontes = await todasFontes(cnpj);
  const algumaOk = Object.values(fontes).some((x) => x.ok);
  if (!algumaOk) throw new Error('CNPJ não localizado em nenhuma fonte');
  const dados = agregar(cnpj, fontes);
  setCache(`v4:${cnpj}`, dados);
  return { dados, cache: false };
}

const wrap = (fn) => async (req, res) => {
  try {
    const cnpj = limparCNPJ(req.params.cnpj);
    if (!validarCNPJ(cnpj)) return res.status(400).json({ erro: 'CNPJ inválido' });
    const { dados, cache } = await consultarComCache(cnpj);
    res.set('X-Cache', cache ? 'HIT' : 'MISS');
    await fn(req, res, dados);
  } catch (e) {
    const status = /não localizado/i.test(e.message) ? 404 : 500;
    res.status(status).json({ erro: e.message });
  }
};

app.get('/cnpj/:cnpj', wrap((req, res, d) => res.json(d)));

app.get('/cnpj/:cnpj/resumo', wrap((req, res, d) => res.json(limpar({
  identificacao: d.identificacao,
  situacaoCadastral: d.situacaoCadastral,
  contato: d.contato,
  endereco: d.endereco,
  atividadePrincipal: d.atividadePrincipal,
  simplesNacional: d.simplesNacional,
  simei: d.simei,
  quadroSocietario: d.quadroSocietario,
  metadados: d.metadados,
}))));

app.get('/cnpj/:cnpj/socios', wrap((req, res, d) => {
  if (!d.socios) return res.status(404).json({ erro: 'Nenhum sócio registrado' });
  res.json({
    cnpj: d.identificacao.cnpj,
    razaoSocial: d.identificacao.razaoSocial,
    resumo: d.quadroSocietario,
    socios: d.socios,
  });
}));

app.get('/cnpj/:cnpj/simples', wrap((req, res, d) => {
  if (!d.simplesNacional && !d.simei && !d.regimeTributario) return res.status(404).json({ erro: 'Sem dados de Simples/MEI/Regime' });
  res.json(limpar({
    cnpj: d.identificacao.cnpj,
    razaoSocial: d.identificacao.razaoSocial,
    porte: d.identificacao.porte,
    naturezaJuridica: d.identificacao.naturezaJuridica,
    capitalSocial: d.identificacao.capitalSocialFormatado,
    simplesNacional: d.simplesNacional,
    simei: d.simei,
    regimeTributario: d.regimeTributario,
  }));
}));

app.get('/cnpj/:cnpj/atividades', wrap((req, res, d) => res.json(limpar({
  cnpj: d.identificacao.cnpj,
  razaoSocial: d.identificacao.razaoSocial,
  principal: d.atividadePrincipal,
  secundarias: d.atividadesSecundarias,
  totalSecundarias: d.totalAtividadesSecundarias,
}))));

app.get('/cnpj/:cnpj/endereco', wrap((req, res, d) => {
  if (!d.endereco) return res.status(404).json({ erro: 'Endereço indisponível' });
  res.json({ cnpj: d.identificacao.cnpj, razaoSocial: d.identificacao.razaoSocial, endereco: d.endereco });
}));

app.get('/cnpj/:cnpj/inscricoes', wrap((req, res, d) => {
  if (!d.inscricoes) return res.status(404).json({ erro: 'Sem inscrições registradas' });
  res.json({ cnpj: d.identificacao.cnpj, razaoSocial: d.identificacao.razaoSocial, inscricoes: d.inscricoes });
}));

app.get('/cnpj/:cnpj/regime', wrap((req, res, d) => {
  if (!d.regimeTributario) return res.status(404).json({ erro: 'Sem regime tributário' });
  res.json({ cnpj: d.identificacao.cnpj, razaoSocial: d.identificacao.razaoSocial, regimeTributario: d.regimeTributario });
}));

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), cache: cache.size }));
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

app.listen(PORT, () => {
  console.log(`SupCnpj em http://localhost:${PORT}`);
  console.log(`Exemplo: http://localhost:${PORT}/cnpj/19131243000197`);
});

module.exports = app;