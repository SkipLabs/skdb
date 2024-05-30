from pybind11.setup_helpers import Pybind11Extension, build_ext
from setuptools import setup, Extension
from setuptools.command.install_lib import install_lib
from shutil import copyfile
import os

__version__ = "0.1.0"

libskdb_path = os.path.join("..", "sql", "target", "host", "release", "libskdb.so")
if not os.path.exists(libskdb_path):
    raise Exception("libskdb.so not found: build it first (`cargo build -r --lib`)")

copyfile(libskdb_path, "libskdb.so")

ext_modules = [
    Pybind11Extension(
        "skdb",
        sources=["src/skdb.cpp"],
        libraries=["skdb"],
        library_dirs=["."],
        runtime_library_dirs=["."],
        include_dirs=["../sql/ffi/include"],
    ),
]

setup(
    name="skdb",
    version=__version__,
    author="SkipLabs",
    author_email="contact@skiplabs.io",
    url="https://github.com/skiplabs/skdb",
    description="",
    long_description="",
    ext_modules=ext_modules,
    extras_require={"test": "pytest"},
    # Currently, build_ext only provides an optional "highest supported C++
    # level" feature, but in the future it may provide more features.
    cmdclass={"build_ext": build_ext},
    packages=[''],
    package_dir={'': '.'},
    package_data={'': ["libskdb.so"]},
    zip_safe=False,
    python_requires=">=3.7",
)
