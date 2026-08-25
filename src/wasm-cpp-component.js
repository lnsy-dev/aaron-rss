/**
 * WebAssembly C++ Example Component
 *
 * Demonstrates loading and using a C++ WebAssembly module compiled with
 * Emscripten. This component provides a simple UI for computing Fibonacci
 * numbers using the compiled wasm binary.
 *
 * Architecture:
 *   1. The C++ source (src/wasm/cpp/fibonacci.cpp) is compiled with Emscripten
 *      to produce fibonacci.js (glue code) and fibonacci.wasm (binary).
 *   2. This component dynamically imports the Emscripten glue module.
 *   3. The glue module loads the .wasm binary and exposes cwrap/ccall helpers.
 *   4. We use cwrap to create a typed JavaScript function that calls the C++ fib().
 *
 * For LLMs: When adding your own C++ wasm module:
 *   - Place .cpp source in src/wasm/cpp/
 *   - Use EMSCRIPTEN_KEEPALIVE on exported functions
 *   - Build with: npm run build:wasm:cpp
 *   - Import the glue module with dynamic import() for async initialization
 */

import DataroomElement from 'dataroom-js';

/**
 * Import the C++ wasm binary URL.
 *
 * Webpack's asset/resource loader processes this import and emits the
 * .wasm file to dist/wasm/. The import returns the public URL string.
 * We pass this URL to the Emscripten module via locateFile so it knows
 * where to fetch the binary at runtime.
 */
import wasmUrl from './wasm/cpp/fibonacci.wasm';

/**
 * WasmCppComponent
 *
 * A custom HTML element that loads a C++ WebAssembly module and provides
 * an interactive Fibonacci calculator.
 *
 * @extends DataroomElement
 */
class WasmCppComponent extends DataroomElement {
  /**
   * Initialize the component.
   *
   * Creates the UI elements and sets up the C++ wasm module.
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    // Create a section heading so users know what this demo is
    this.create('h2', { content: 'WebAssembly C++ Example' });

    // Description paragraph explaining the demo
    this.create('p', {
      content: 'This computes Fibonacci numbers using a C++ function compiled to WebAssembly via Emscripten.',
    });

    // Input field for the user to enter a number
    this.input = this.create('input', {
      type: 'number',
      value: '10',
      placeholder: 'Enter a number',
    });

    // Button to trigger the computation
    const button = this.create('button', { content: 'Compute (C++)' });

    // Result display paragraph
    this.resultDisplay = this.create('p', { content: 'Result will appear here.' });

    /**
     * Load the Emscripten-generated module.
     *
     * Dynamic import() is used because Emscripten MODULARIZE output
     * is an async factory function. It returns a Promise that resolves
     * when the wasm runtime is fully initialized.
     *
     * We configure locateFile so the Emscripten runtime fetches the wasm
     * binary from the URL provided by webpack's asset/resource loader
     * instead of trying to compute a relative path from document.currentScript.
     */
    try {
      const FibonacciCppModule = await import('./wasm/cpp/fibonacci.js');

      /**
       * Instantiate the Emscripten module with custom locateFile.
       *
       * locateFile tells Emscripten where to find companion files
       * (like the .wasm binary). By default it tries to compute a path
       * relative to the script tag, which breaks when webpack bundles
       * the glue code into a single JS file.
       */
      const Module = await FibonacciCppModule.default({
        locateFile: (filename) => {
          if (filename.endsWith('.wasm')) {
            return wasmUrl;
          }
          return filename;
        },
      });

      /**
       * Create a wrapped JavaScript function for the C++ fib() function.
       *
       * cwrap signature: cwrap(functionName, returnType, argumentTypes)
       *   - 'fib' is the exported C++ function name
       *   - 'number' is the JavaScript return type
       *   - ['number'] is an array of argument types
       */
      this.fib = Module.cwrap('fib', 'number', ['number']);

      // Attach click handler once the module is ready
      button.addEventListener('click', () => this.compute());
    } catch (error) {
      // Graceful error handling: show the user what went wrong
      console.error('Failed to load C++ WebAssembly module:', error);
      this.resultDisplay.textContent = `Error loading wasm: ${error.message}`;
      this.event('WASM-CPP-ERROR', { error: error.message });
    }
  }

  /**
   * Compute the Fibonacci number from the input value.
   *
   * Reads the current input value, calls the C++ wasm function,
   * and updates the result display.
   *
   * @returns {void}
   */
  compute() {
    const n = parseInt(this.input.value, 10);

    // Validate input
    if (Number.isNaN(n) || n < 0) {
      this.resultDisplay.textContent = 'Please enter a non-negative integer.';
      return;
    }

    try {
      // Call the C++ function through the cwrap proxy
      const result = this.fib(n);
      this.resultDisplay.textContent = `fib(${n}) = ${result}`;

      // Emit a dataroom event so other components can listen
      this.event('WASM-CPP-RESULT', { n, result, language: 'cpp' });
    } catch (error) {
      console.error('Error computing Fibonacci:', error);
      this.resultDisplay.textContent = `Computation error: ${error.message}`;
      this.event('WASM-CPP-ERROR', { error: error.message });
    }
  }
}

// Register the custom element with a hyphenated name (required by spec)
if (!customElements.get('wasm-cpp-component')) {
  customElements.define('wasm-cpp-component', WasmCppComponent);
}
