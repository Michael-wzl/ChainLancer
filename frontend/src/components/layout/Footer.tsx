import React from "react";

export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-400">
      <p>ChainLancer — Decentralized Freelance Escrow Platform</p>
      <p className="mt-1">IS4302 Project • {new Date().getFullYear()}</p>
    </footer>
  );
}
