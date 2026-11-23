# FETTUCCINE

Project page for *FETTUCCINE: Fast and efficient brain-to-text decoding on mobile devices* (NeurIPS 2026, Spotlight).

**<https://fettuccine-brain2text.github.io/>**

A static site (HTML, CSS, JavaScript). The live demo runs FETTUCCINE (Whisper-Tiny) in the browser with ONNX Runtime Web.

## Run locally

```bash
python3 serve.py   # opens http://localhost:8000
```

`index.html` is generated from `page.html`: edit `page.html`, then run `pip install segno && python3 build_page.py`.

## License

- Code: [MIT](LICENSE)
- Paper content, model weights and results: [CC BY-NC 4.0](LICENSE-CONTENT.md)
- Neural recordings: brain-to-text 2025 dataset, CC0
- Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

© 2026 The FETTUCCINE authors
