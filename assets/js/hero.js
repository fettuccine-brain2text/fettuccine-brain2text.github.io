// Hero: the FETTUCCINE phone (phone.js) replays recorded trials with their measured iPhone latencies.
import { mountPhone, playPhone } from './phone.js';

export async function initHero(data) {
  const stage = document.getElementById('phoneStage');
  const phone = mountPhone(stage);
  await playPhone(phone, data.trials);
  requestAnimationFrame(() => stage.classList.add('in'));
}
