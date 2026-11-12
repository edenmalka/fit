// Photo → 3D with Microsoft TRELLIS.2 on a free Hugging Face Space (ZeroGPU).
// GPU time comes from the signed-in user's free daily allowance.

import { TRELLIS_SPACE } from './config.js';

// Pinned version: change on purpose only.
const GRADIO = 'https://cdn.jsdelivr.net/npm/@gradio/client@2.7.1/dist/browser.js';

// Space progress labels → friendly Hebrew steps (with a rough share of the total time).
const STEPS = [
  { match: /zerogpu|init/i,            text: 'מקבלים מעבד גרפי',        at: 0.12 },
  { match: /sparse/i,                  text: 'בונים את הצורה הכללית',   at: 0.25 },
  { match: /shape/i,                   text: 'מפסלים את הפרטים',        at: 0.45 },
  { match: /tex/i,                     text: 'צובעים בדים וחומרים',      at: 0.65 },
  { match: /render/i,                  text: 'בודקים את התוצאה',        at: 0.78 },
];

export class TrellisError extends Error {
  constructor(kind, message, retryIn) { super(message); this.kind = kind; this.retryIn = retryIn; }
}

function classify(err) {
  const msg = String(err?.message || err?.title || err || '');
  if (/quota/i.test(msg)) {
    const m = msg.match(/try again in\s+(\d+):(\d+):(\d+)/i);
    const retryIn = m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : null;
    return new TrellisError('quota', msg, retryIn);
  }
  if (/queue.*full|too many|busy|capacity|no gpu|gpu.*unavailable/i.test(msg)) return new TrellisError('busy', msg);
  if (/sleep|paused|building|runtime_error|could not resolve|could not get space status|connection errored|failed to fetch|networkerror/i.test(msg)) return new TrellisError('down', msg);
  if (/401|403|unauthori|log ?in|credentials/i.test(msg)) return new TrellisError('auth', msg);
  return new TrellisError('other', msg);
}

/**
 * pngBlob → GLB ArrayBuffer.
 * onProgress({ text, fraction, queue }) is called with honest progress updates.
 * signal: AbortSignal to cancel.
 */
export async function photoTo3D(pngBlob, { token, onProgress = () => {}, signal } = {}) {
  const say = (text, fraction, extra = {}) => onProgress({ text, fraction, ...extra });
  let app;
  try {
    say('מתחברים לשרת התלת־ממד', 0.02);
    const { Client, handle_file } = await import(GRADIO);
    app = await Client.connect(TRELLIS_SPACE, { token: token || undefined, events: ['data', 'status'] });
    if (signal?.aborted) throw new Error('aborted');

    await app.predict('/start_session', []);
    say('מכינים את התמונה ומסירים רקע', 0.06);
    const pre = await app.predict('/preprocess_image', { input: handle_file(pngBlob) });
    if (signal?.aborted) throw new Error('aborted');

    const job = app.submit('/image_to_3d', {
      image: pre.data[0], seed: 0, resolution: '1024',
      ss_guidance_strength: 7.5, ss_guidance_rescale: 0.7, ss_sampling_steps: 12, ss_rescale_t: 5,
      shape_slat_guidance_strength: 7.5, shape_slat_guidance_rescale: 0.5, shape_slat_sampling_steps: 12, shape_slat_rescale_t: 3,
      tex_slat_guidance_strength: 1, tex_slat_guidance_rescale: 0, tex_slat_sampling_steps: 12, tex_slat_rescale_t: 3,
    });
    signal?.addEventListener('abort', () => job.cancel?.());

    let fraction = 0.08;
    for await (const ev of job) {
      if (signal?.aborted) throw new Error('aborted');
      if (ev.type === 'status') {
        if (ev.stage === 'error') throw new Error(ev.message || 'generation failed');
        if (ev.stage === 'pending' && ev.position != null && ev.position > 0) {
          say(`ממתינים בתור (מקום ${ev.position + 1})`, fraction, { queue: ev.position + 1 });
          continue;
        }
        const p = ev.progress_data?.[0];
        if (p) {
          const step = STEPS.find((s) => s.match.test(p.desc || '')) || null;
          const base = step ? step.at : fraction;
          const inner = p.length ? (p.index || 0) / p.length : 0;
          fraction = Math.max(fraction, base + inner * 0.12);
          say(step ? step.text : 'יוצרים את הדגם', Math.min(fraction, 0.85));
        }
      }
      if (ev.type === 'data') break;
    }

    say('אורזים את הדגם', 0.88);
    const out = await app.predict('/extract_glb', { decimation_target: 150000, texture_size: 1024 });
    const file = out.data?.[1] || out.data?.[0];
    const url = file?.url || file;
    if (!url) throw new Error('no glb returned');

    say('מורידים את הדגם', 0.94);
    const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    if (!res.ok) throw new Error('download failed ' + res.status);
    return await res.arrayBuffer();
  } catch (err) {
    if (signal?.aborted || err?.message === 'aborted') throw new TrellisError('aborted', 'aborted');
    console.error('TRELLIS error', err);
    throw classify(err);
  } finally {
    try { app?.close?.(); } catch {}
  }
}
