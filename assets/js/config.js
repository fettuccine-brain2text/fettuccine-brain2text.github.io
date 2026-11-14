// Site configuration.
window.FETTUCCINE = {
  // true: run the model in the visitor's browser when assets/model/ is present.
  // false: never download weights; the demo replays precomputed outputs of the same model.
  // If assets/model/ is missing or the runtime cannot start, the page falls back to replay automatically.
  live: true,
  // 'auto': time GPU (WebGPU) and CPU at start and keep the faster for each graph. 'cpu' or 'gpu' forces one.
  backend: 'auto',
  // download the model in the background when the demo scrolls into view (desktop only)
  prefetch: true,
  // Paper and arXiv links. Empty entries render as disabled buttons.
  links: {
    'paper-url': '',
    'arxiv-url': '',
  },
};
