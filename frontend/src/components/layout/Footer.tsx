import React from "react";
import { Link } from "react-router-dom";
import { BookOpen, Github } from "lucide-react";

export function Footer({ appName }: { appName: string }) {
  return (
    <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-400">
      <p>{appName} — Decentralized Freelance Escrow Platform</p>
      <div className="mt-2 flex items-center justify-center gap-6">
        <Link
          to="/guide"
          className="inline-flex items-center gap-1.5 text-gray-500 hover:text-brand-600 transition-colors"
        >
          <BookOpen className="h-4 w-4" />
          User Guide
        </Link>
        <a
          href="https://github.com/Michael-wzl/ChainLancer"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-gray-500 hover:text-brand-600 transition-colors"
        >
          <Github className="h-4 w-4" />
          GitHub
        </a>
      </div>
      <p className="mt-2">IS4302 Project • {new Date().getFullYear()}</p>
    </footer>
  );
}
