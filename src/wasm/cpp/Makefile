# Makefile for building the C++ Fibonacci WebAssembly module
#
# Requirements:
#   - Emscripten SDK (emsdk) installed and activated
#   - emcc available in your PATH
#
# To build:
#   make
#   # or from project root:
#   npm run build:wasm:cpp

# Compiler settings
CC = emcc
OUTPUT = fibonacci

# Build flags:
#   -O3          : Optimize for speed
#   -s WASM=1    : Output WebAssembly
#   -s EXPORTED_RUNTIME_METHODS : Export cwrap so JS can call C functions
#   -s MODULARIZE : Wrap output in a factory function for async loading
#   -s EXPORT_NAME : Name of the factory function
#   -s ENVIRONMENT=web : Target web environment only
#   --no-entry   : No main() function required
CFLAGS = -O3 -s WASM=1 \
  -s EXPORTED_RUNTIME_METHODS="['cwrap','ccall']" \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="FibonacciCppModule" \
  -s ENVIRONMENT=web \
  -s EXPORT_ES6=1 \
  --no-entry

all: $(OUTPUT).js $(OUTPUT).wasm

$(OUTPUT).js $(OUTPUT).wasm: fibonacci.cpp
	$(CC) fibonacci.cpp -o $(OUTPUT).js $(CFLAGS)

clean:
	rm -f $(OUTPUT).js $(OUTPUT).wasm

.PHONY: all clean
