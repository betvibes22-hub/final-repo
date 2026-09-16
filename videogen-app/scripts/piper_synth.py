"""
Synthesizes speech with a local Piper voice model and writes a WAV file.

Usage: python3 piper_synth.py <model.onnx path> <output.wav path> [length_scale]
Text is read from stdin (avoids shell-quoting issues with apostrophes/
commas in narration text — same lesson learned from the ffmpeg caption
textfile approach earlier in this project).

length_scale is Piper's own speed parameter (< 1 faster, > 1 slower,
omit for the model's default/normal pace) — this is what backs the
per-voice pace control.
"""
import sys
import wave

from piper import PiperVoice
from piper.config import SynthesisConfig


def main() -> int:
    model_path = sys.argv[1]
    output_path = sys.argv[2]
    length_scale_arg = sys.argv[3] if len(sys.argv) > 3 else ""
    text = sys.stdin.read()

    voice = PiperVoice.load(model_path)

    syn_config = None
    if length_scale_arg:
        syn_config = SynthesisConfig(length_scale=float(length_scale_arg))

    wrote_any = False
    with wave.open(output_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        for chunk in voice.synthesize(text, syn_config=syn_config):
            if not wrote_any:
                wf.setframerate(chunk.sample_rate)
                wrote_any = True
            wf.writeframes(chunk.audio_int16_bytes)

    if not wrote_any:
        sys.stderr.write("No audio produced\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
