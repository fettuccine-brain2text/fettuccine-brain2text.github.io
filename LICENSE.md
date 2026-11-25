# License

Copyright (c) 2026 The FETTUCCINE authors.

This website, its code, the paper content on it and the model weights in `assets/model/` are licensed under
[Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/),
the same license as the paper. Commercial use needs written permission from the authors. This covers:

- the website code (HTML, CSS, JavaScript and Python files), except the third-party components listed in `THIRD_PARTY_NOTICES.md`;
- the text, figures and tables reproduced from the paper, and the numbers behind the charts (`assets/data/site.json`);
- the decoded outputs, saliency maps and lesion results in `assets/data/`;
- the trained model weights (`assets/model/`), which are fine-tuned from Whisper (MIT, see `THIRD_PARTY_NOTICES.md`);
- `assets/img/`, except `t15_brain.webp` and `t15_brain_zoom.webp`: these are adapted with permission from
  Card et al., *NEJM* 2024, and are not covered by this license (all rights reserved by their authors).

The participant video in `assets/video/` (`t16_demo.mp4` and its poster image) is not covered by this
license. It shows a research participant and is shared with their consent for viewing on this site only.
All rights are reserved; do not copy, edit or redistribute it.

Please cite the paper when you reuse them (see the Citation section of the site).

The neural recordings in `assets/data/trials/*.bin.gz` and `assets/data/hero.json` are excerpts of the
Brain-to-Text '25 dataset (Card et al., *NEJM* 2024; [Dryad](https://datadryad.org/stash/dataset/doi:10.5061/dryad.dncjsxm85)),
released under CC0 1.0.
