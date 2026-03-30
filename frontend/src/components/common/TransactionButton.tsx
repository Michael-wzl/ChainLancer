import React from "react";
import { Loader2 } from "lucide-react";

interface TransactionButtonProps {
  onClick: () => Promise<void> | void;
  isLoading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "success";
  children: React.ReactNode;
  className?: string;
}

export function TransactionButton({
  onClick,
  isLoading = false,
  disabled = false,
  variant = "primary",
  children,
  className = "",
}: TransactionButtonProps) {
  const variantClass = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    danger: "btn-danger",
    success: "btn-success",
  }[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`${variantClass} ${className}`}
    >
      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
