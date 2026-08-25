# C++ WebAssembly Example

This directory contains a simple C++ function compiled to WebAssembly using Emscripten.

## What It Does

The `fibonacci.cpp` file exports a single function:

```cpp
int fib(int n)
```

Which computes the nth Fibonacci number iteratively.

## Pre-built Artifacts

The following files are pre-built and ready to use:

- `fibonacci.js` — Emscripten-generated JavaScript glue code
- `fibonacci.wasm` — Compiled WebAssembly binary

You can import the glue code directly in your JavaScript:

```javascript
import FibonacciCppModule from './wasm/cpp/fibonacci.js';

const module = await FibonacciCppModule();
const fib = module.cwrap('fib', 'number', ['number']);
console.log(fib(10)); // 55
```

## Rebuilding from Source

### Prerequisites

Install the Emscripten SDK:

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

### Build

From the project root:

```bash
npm run build:wasm:cpp
```

Or from this directory:

```bash
make
```

This will regenerate `fibonacci.js` and `fibonacci.wasm`.

## Makefile Options

The Makefile uses the following Emscripten flags:

- `-O3` — Maximum speed optimization
- `-s WASM=1` — Emit WebAssembly
- `-s MODULARIZE=1` — Wrap in an async factory function
- `-s EXPORTED_RUNTIME_METHODS` — Expose `cwrap` and `ccall`
- `--no-entry` — No `main()` function required
