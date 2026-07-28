# Punaab free music library

Place `.mp3` files here. Currently shipping:

- until-it-leads-me-home.mp3
- the-grass-grows-green.mp3

Served at `/music/<filename>` and listed from `/music` via `lib/music.ts`.
Only tracks with a file in this folder should be registered in code.
Also register character repertoire entries in `lib/bard/songs.ts`.

After adding or removing tracks, rebuild the all-pack zip:

```
npm run pack:music
```

That writes `public/downloads/punaab-music.zip`.
