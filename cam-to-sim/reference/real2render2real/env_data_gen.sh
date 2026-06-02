#!/bin/bash
# Data Generation Installation
pip install uv
uv venv --python 3.10.15
source .venv/bin/activate

git submodule init && git submodule update
uv pip install --upgrade pip
uv pip install torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu121
uv pip install 'isaacsim[all,extscache]==4.5.0' --extra-index-url https://pypi.nvidia.com
cd dependencies/IsaacLab
./isaaclab.sh --install #If you get an error with egl_prob failing to install, try running `./isaaclab_alt.sh --install`
cd ../rsrd
git submodule init && git submodule update
cd dependencies/
uv pip install -e jaxmp -e jaxls
cd ../..
uv pip install -e trajgen
uv pip install viser
uv pip install viser[examples]
uv pip install -U "jax[cuda12]"==0.5.3
cd ..
uv pip install -e .
uv pip install mujoco==3.3.1