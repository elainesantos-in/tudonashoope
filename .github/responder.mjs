// Robô do QUERO: lê os comentários dos posts recentes do Instagram e, para cada "QUERO" novo, manda no direct
// (resposta privada ao comentário) o link da página com os produtos daquele carrossel e responde o comentário.
// Se a Meta não deixar mandar o direct (app sem aprovação), responde só no comentário apontando o link da bio.
// Uso: node scripts/responder.mjs [--site <pasta do site>] [--estado <arquivo>] [--simular]
// Lê META_PAGE_TOKEN, IG_USER_ID e FB_PAGE_ID. Roda no PC ou no GitHub Actions (não depende de nada além do Node).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = 'https://graph.facebook.com/v26.0';
const URL_SITE = 'https://tudonashoope.pages.dev';
const args = process.argv.slice(2);
const opcao = (nome, padrao) => (args.includes(nome) ? args[args.indexOf(nome) + 1] : padrao);
const SITE = resolve(opcao('--site', join(import.meta.dirname, '..', 'site')));
const ESTADO = resolve(opcao('--estado', join(SITE, 'respondidos.json')));
const simular = args.includes('--simular');

const { META_PAGE_TOKEN: token, IG_USER_ID: igId, FB_PAGE_ID: pageId } = process.env;
if (!token || !igId || !pageId) { console.error('Faltam META_PAGE_TOKEN, IG_USER_ID ou FB_PAGE_ID.'); process.exit(1); }

async function graph(caminho, params = {}, metodo = 'GET') {
  const corpo = new URLSearchParams({ ...params, access_token: token });
  const resp = metodo === 'GET' ? await fetch(`${API}/${caminho}?${corpo}`) : await fetch(`${API}/${caminho}`, { method: 'POST', body: corpo });
  const json = await resp.json();
  if (json.error) throw new Error(json.error.error_user_msg ?? json.error.message);
  return json;
}

// Qual post é qual: o publicar.mjs grava no posts.json do site o id do post do Instagram e os nomes dos produtos.
// Cada produto tem link curto em p/<slug>/<n>/ (redireciona para o link de afiliado).
const posts = existsSync(join(SITE, 'posts.json')) ? JSON.parse(readFileSync(join(SITE, 'posts.json'), 'utf8')) : [];
function mensagemDoPost(mediaId) {
  const p = posts.find((x) => x.instagram === mediaId);
  if (!p) return { link: `${URL_SITE}/`, texto: `Oi! 🤎 Aqui estão os links dos achadinhos:\n${URL_SITE}/\n\nÉ só tocar pra ver na Shopee ✨` };
  const pagina = `${URL_SITE}/p/${p.slug}/`;
  // Lista no formato que a Elaine pediu: nome do produto e, embaixo, o link dele.
  const lista = (p.produtos ?? []).map((prod, i) => `${prod.nome}\n${pagina}${i + 1}/`).join('\n\n');
  const texto = `Oi! 🤎 Aqui estão os links dos produtos do post:\n\n${lista}\n\nÉ só tocar pra ver na Shopee ✨`;
  // A mensagem do Instagram aceita até 1000 caracteres; se passar, manda a página com todos.
  return { link: pagina, texto: lista && texto.length <= 1000 ? texto : `Oi! 🤎 Aqui estão os links de todos os produtos do post:\n${pagina}\n\nÉ só tocar em cada um pra ver na Shopee ✨` };
}
const estado = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : {};
const QUERO = /\bquero\b/i;
const SETE_DIAS = 7 * 864e5; // a Meta só aceita resposta privada até 7 dias depois do comentário

// Resposta privada: a API do Instagram pela Página aceita no endpoint da Página; se não, tenta no do Instagram.
async function mandarDirect(commentId, texto) {
  const params = { recipient: JSON.stringify({ comment_id: commentId }), message: JSON.stringify({ text: texto }) };
  try { return await graph(`${pageId}/messages`, params, 'POST'); }
  catch (e1) {
    try { return await graph(`${igId}/messages`, params, 'POST'); }
    catch (e2) { throw new Error(`${e1.message} / ${e2.message}`); }
  }
}

const { data: midias } = await graph(`${igId}/media`, { fields: 'id,timestamp', limit: '15' });
let novos = 0;
for (const m of midias) {
  const { data: comentarios } = await graph(`${m.id}/comments`, { fields: 'id,text,username,timestamp', limit: '100' });
  for (const c of comentarios) {
    if (estado[c.id] || !QUERO.test(c.text ?? '') || c.username === 'tudonashoope1') continue;
    if (Date.now() - Date.parse(c.timestamp) > SETE_DIAS) { estado[c.id] = { quando: new Date().toISOString(), pulado: 'mais de 7 dias' }; continue; }
    const { link, texto } = mensagemDoPost(m.id);
    novos++;
    if (simular) { console.log(`[simulação] @${c.username}: "${c.text}" → ${link}`); continue; }

    let direct = false, erro = null;
    try {
      await mandarDirect(c.id, texto);
      direct = true;
    } catch (e) { erro = e.message; }
    try { await graph(`${c.id}/replies`, { message: direct ? `Te mandei no direct, @${c.username} 🤎` : `@${c.username} os links de tudo estão no link da bio 🤎` }, 'POST'); }
    catch (e) { erro = [erro, `resposta no comentário: ${e.message}`].filter(Boolean).join(' / '); }

    estado[c.id] = { quando: new Date().toISOString(), usuario: c.username, direct, ...(erro ? { erro } : {}) };
    console.log(`${direct ? '✓ direct' : '· só comentário'} @${c.username} → ${link}${erro ? ` (${erro})` : ''}`);
  }
}
if (!simular) writeFileSync(ESTADO, JSON.stringify(estado, null, 2) + '\n');
console.log(novos ? `${novos} QUERO novo(s).` : 'Nenhum QUERO novo.');
