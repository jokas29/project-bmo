"""Reference Hugging Face Space for DropEC private commercial-visual experiment.
Output is ONLY a generated photographic scene. Real product image, captions and
prices are composited afterwards on a separate trusted runner.
"""
import gradio as gr
import spaces
import torch
from PIL import Image
from diffusers import Flux2KleinPipeline

MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"  # Apache-2.0: NOT 9B/dev
pipe = Flux2KleinPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
# The ZeroGPU CUDA emulator expects placement during module initialization.
pipe.to("cuda")

@spaces.GPU(duration=60)
def generate(image: Image.Image | None, prompt: str, seed: int) -> Image.Image:
    if image is not None and not (160 <= min(image.size) and max(image.size) <= 9000):
        raise gr.Error("Source photo not usable; remove it to generate a labelled concept.")
    if len(prompt) > 2000:
        raise gr.Error("Prompt too long.")
    photo = image.convert("RGB") if image is not None else None
    if photo is not None:
        photo.thumbnail((1024,1024),resample=Image.Resampling.LANCZOS)
    with torch.inference_mode():
        args = {"image": photo} if photo is not None else {}
        result = pipe(
            **args,
            prompt=prompt,
            width=896,
            height=896,
            num_inference_steps=4,
            guidance_scale=1.0,
            generator=torch.Generator(device="cuda").manual_seed(int(seed) % (2**32)),
        ).images[0]
    return result

gr.Interface(
    fn=generate,
    inputs=[gr.Image(type="pil", label="Optional product reference photo"),
            gr.Textbox(label="Scene prompt", lines=6),
            gr.Number(value=42, precision=0, label="Seed")],
    outputs=gr.Image(type="pil",label="Synthetic scenery — not final ad"),
    title="DropEC experimental scene generator",
    description="Staging only. FLUX creates an entire scene. Without a reference the output is conceptual, never an authentic product photo. No Meta publishing.",
    api_name="generate",
    flagging_mode="never",
).queue(max_size=4, default_concurrency_limit=1).launch()
