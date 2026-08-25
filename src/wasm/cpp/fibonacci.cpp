/**
 * C++ WebAssembly Example: Fibonacci Calculator
 *
 * This file demonstrates how to write a simple C++ function that can be
 * compiled to WebAssembly using Emscripten and called from JavaScript.
 *
 * Build Command (requires Emscripten SDK):
 *   make
 *
 * The EMSCRIPTEN_KEEPALIVE macro ensures the function is exported and not
 * dead-code eliminated by the linker.
 */

#include <emscripten.h>

/**
 * Compute the nth Fibonacci number.
 *
 * @param n The position in the Fibonacci sequence (0-indexed).
 * @return The nth Fibonacci number.
 */
extern "C" {
  EMSCRIPTEN_KEEPALIVE
  int fib(int n) {
    if (n <= 1) {
      return n;
    }
    int a = 0, b = 1;
    for (int i = 2; i <= n; ++i) {
      int temp = a + b;
      a = b;
      b = temp;
    }
    return b;
  }
}
