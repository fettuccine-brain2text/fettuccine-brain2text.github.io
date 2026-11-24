# FETTUCCINE

Project page for *FETTUCCINE: Fast and efficient brain-to-text decoding on mobile devices* (NeurIPS 2026, Spotlight).

**<https://fettuccine-brain2text.github.io/>**

A static site (HTML, CSS, JavaScript). The live demo runs FETTUCCINE Whisper Tiny, quantized to 8-bit weights, in the browser with ONNX Runtime Web.

## Run locally

```bash
python3 serve.py   # opens http://localhost:8000
```

`index.html` is generated from `page.html`: edit `page.html`, then run `pip install segno && python3 build_page.py`.

## License

- Code: [MIT](LICENSE)
- Paper content, model weights, and results: [CC BY-NC 4.0](LICENSE-CONTENT.md)
- Neural recordings: brain-to-text 2025 (T15; [Card et al., 2024](https://doi.org/10.1056/NEJMoa2314132)) and brain-to-text 2024 (T12; [Willett et al., 2023](https://doi.org/10.1038/s41586-023-06377-x)) datasets, CC0
- Brain images (`assets/img/t15_brain*.webp`): adapted with permission from Card et al., 2024; not covered by our licenses
- Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

© 2026 The FETTUCCINE authors
