import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Briefcase,
  LayoutDashboard,
  PlusCircle,
  User,
  Wallet as WalletIcon,
  Search,
  Shield,
  HammerIcon,
} from "lucide-react";
import { ConnectButton } from "../wallet/ConnectButton";
import { NetworkBadge } from "../wallet/NetworkBadge";
import { useWallet } from "../../contexts/WalletContext";
import { useContracts } from "../../contexts/ContractContext";
import { ROLES } from "../../config/constants";

const BASE_NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/browse", label: "Browse Jobs", icon: Search },
  { to: "/post-job", label: "Post Job", icon: PlusCircle },
  { to: "/profile", label: "Profile", icon: User },
  { to: "/wallet", label: "Wallet", icon: WalletIcon },
];

const ROLE_NAV_ITEMS = [
  { to: "/judge", label: "Judge", icon: HammerIcon, requiredRole: "judge" as const },
  { to: "/admin", label: "Admin", icon: Shield, requiredRole: "admin" as const },
];

type NavbarProps = {
  appName: string;
};

export function Navbar({ appName }: NavbarProps) {
  const location = useLocation();
  const { address } = useWallet();
  const { readContracts } = useContracts();
  const [isJudge, setIsJudge] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!address || !readContracts?.dispute) {
      setIsJudge(false);
      setIsAdmin(false);
      return;
    }
    const checkRoles = async () => {
      try {
        const judge = await readContracts.dispute!.hasRole(ROLES.PLATFORM_JUDGE, address);
        setIsJudge(judge);
      } catch { setIsJudge(false); }
      try {
        const admin = await readContracts.dispute!.hasRole(ROLES.PLATFORM_ADMIN, address);
        const defaultAdmin = await readContracts.dispute!.hasRole(
          "0x0000000000000000000000000000000000000000000000000000000000000000", address
        );
        setIsAdmin(admin || defaultAdmin);
      } catch { setIsAdmin(false); }
    };
    checkRoles();
  }, [address, readContracts?.dispute]);

  const NAV_ITEMS = [
    ...BASE_NAV_ITEMS,
    ...ROLE_NAV_ITEMS.filter(item => {
      if (item.requiredRole === "judge") return isJudge;
      if (item.requiredRole === "admin") return isAdmin;
      return true;
    }),
  ];
  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <img
              src="/chainlancer-logo.svg"
              alt="GigSecure Logo"
              className="h-8 w-8"
            />
            <span className="text-lg font-bold text-gray-900">{appName}</span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive
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
                key={item.label}
                to={item.to}
                className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${isActive
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
