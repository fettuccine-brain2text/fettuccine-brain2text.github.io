# Content license

Copyright (c) 2026 The FETTUCCINE authors.

Everything on this site except the website code is licensed under
[Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/),
the same license as the paper. Commercial use needs written permission from the authors. This covers:

- the text, figures, and tables reproduced from the paper, and the numbers behind the charts (`assets/data/site.json`);
- the decoded outputs, saliency maps, and lesion results in `assets/data/`;
- the trained model weights, including the in-browser model in `assets/model/`, which are finetuned from Whisper (MIT, see `THIRD_PARTY_NOTICES.md`);
- the participant video and its poster image in `assets/video/`;
- `assets/img/`, except the brain images below.

Please cite the paper when you reuse them (see the Citation section of the site).

The neural recordings in `assets/data/trials/*.bin.gz` and `assets/data/hero.json` are excerpts of the
brain-to-text 2025 dataset (participant T15; Card et al., *NEJM* 2024; [Dryad](https://datadryad.org/stash/dataset/doi:10.5061/dryad.dncjsxm85)),
released under CC0 1.0. Results for participant T12 come from models trained on the brain-to-text 2024 dataset
(Willett et al., *Nature* 2023; [Dryad](https://datadryad.org/stash/dataset/doi:10.5061/dryad.x69p8czpq)), also released under CC0 1.0.

The brain images `assets/img/t15_brain.webp` and `assets/img/t15_brain_zoom.webp` (participant T15's array locations)
are adapted with permission from Card et al., *NEJM* 2024 (<https://doi.org/10.1056/NEJMoa2314132>). They are not
covered by this license.

The website code (HTML, CSS, JavaScript, and Python files) is licensed separately under the MIT License (`LICENSE`),
except the third-party components listed in `THIRD_PARTY_NOTICES.md`.
