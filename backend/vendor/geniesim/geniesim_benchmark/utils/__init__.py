# URDF Studio shim — NOT part of the vendored Genie Sim sources.
# The upstream utils/__init__.py also re-exports generalization_utils, which is
# not vendored; only system_utils is exposed here.
from .system_utils import *
