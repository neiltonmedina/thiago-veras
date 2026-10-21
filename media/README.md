# Fotos e vídeos das casas

Cada casa tem uma pasta com o código dela em minúsculo:

```
media/
├── c01/
│   ├── foto1.jpg
│   ├── foto2.jpg
│   ├── foto3.jpg
│   └── tour.mp4
├── c02/
...
```

Os nomes precisam bater com `photos` e `video` em `src/houses/data.json`.
O bot envia as 3 primeiras fotos da lista e o vídeo.

## Limites do WhatsApp

- **Foto:** JPG, até 5 MB (o ideal é em torno de 300 KB, 1280px no lado maior)
- **Vídeo:** MP4 (H.264), **até 16 MB**. Acima disso o WhatsApp recusa.
  Um tour de 30 a 60 segundos em 720p fica dentro do limite.

## Conferir antes do deploy

```bash
npm run check:media
```

Lista arquivos faltando ou acima do limite.
