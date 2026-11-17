`sample.mp4` is a generated, silent red frame for native video import/playback tests. It is not
downloaded media. The committed fixture keeps FFmpeg out of CI requirements.

To regenerate:

```sh
ffmpeg -f lavfi -i color=c=red:s=160x90:r=10 -t 0.3 -c:v libx264 -profile:v baseline -pix_fmt yuv420p -movflags +faststart sample.mp4
```
