# ADR-0002: Node.js runtime contract

Shipping Mode uses a self-contained JavaScript bundle and requires Node.js
20+. The launcher performs a fail-closed preflight and emits structured JSON;
it does not install or manage Node.js. The fixture matrix covers Node 18,
Node 20, Node 22, and paths containing spaces or Unicode.
