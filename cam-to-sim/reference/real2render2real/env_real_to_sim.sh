#!/bin/bash
conda create --name r2r2r_rsrd python=3.10.15
conda activate r2r2r_rsrd
pip install --upgrade pip

conda install -c "nvidia/label/cuda-11.8.0" cuda-toolkit
pip install ninja git+https://github.com/NVlabs/tiny-cuda-nn/#subdirectory=bindings/torch
pip install gsplat==1.4.0
# NVCC_FLAGS="-gencode=arch=compute_80,code=sm_80 -gencode=arch=compute_80,code=sm_80" pip install git+https://github.com/nerfstudio-project/gsplat.git@v1.4.0
cd dependencies/rsrd
git submodule init && git submodule update
pip install -e .
pip install nerfstudio==1.1.5
pip install --extra-index-url=https://pypi.nvidia.com cudf-cu12==24.10.* cuml-cu12==24.10.*
pip install -U "jax[cuda12]"==0.5.3 # seems jax 0.6.2 was pre-installed in the conda env
cd dependencies/
pip install -e dig -e garfield -e hamer_helper -e jaxls -e jaxmp

# although pip says they conflict, they don't seem to
pip install torchtyping==0.1.5
pip install typeguard==4.4.4
pip install warp-lang
pip install mujoco==3.2.3

# HaMeR installation
cd hamer
git submodule init && git submodule update
pip install -e .[all]
pip install -v -e third-party/ViTPose
# make sure to register to the MANO website and download the MANO_RIGHT.pkl file and place it under the _DATA/data/mano folder
# then run the demo script included in their repo to ensure it works
