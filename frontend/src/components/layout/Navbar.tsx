import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Briefcase,
  LayoutDashboard,
  PlusCircle,
  User,
  Wallet as WalletIcon,
  Search,
} from "lucide-react";
import { ConnectButton } from "../wallet/ConnectButton";
import { NetworkBadge } from "../wallet/NetworkBadge";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/browse", label: "Browse Jobs", icon: Search },
  { to: "/post-job", label: "Post Job", icon: PlusCircle },
  { to: "/profile", label: "Profile", icon: User },
  { to: "/wallet", label: "Wallet", icon: WalletIcon },
];

export function Navbar() {
  const location = useLocation();

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <img src="/chainlancer-logo.svg" alt="ChainLancer" className="h-8 w-8" />
            <span className="text-lg font-bold text-gray-900">ChainLancer</span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Wallet */}
          <div className="flex items-center gap-3">
            <NetworkBadge />
            <ConnectButton />
          </div>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="md:hidden border-t border-gray-200 bg-white">
        <div className="flex overflow-x-auto px-4 py-2 gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
