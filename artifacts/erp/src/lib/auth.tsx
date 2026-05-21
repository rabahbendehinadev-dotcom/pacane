import React, { createContext, useContext, useEffect, useState } from "react";
import { useGetMe, User } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  activeBranchId: number | null;
  setActiveBranchId: (id: number | null) => void;
  setToken: (token: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem("erp_token"));

  const setToken = (newToken: string) => {
    localStorage.setItem("erp_token", newToken);
    setTokenState(newToken);
  };

  const { data: user, isLoading, isError } = useGetMe({
    query: {
      queryKey: ["auth-me", token],
      enabled: !!token,
      retry: false,
    }
  });

  const [activeBranchId, setActiveBranchId] = useState<number | null>(null);
  const [branchInitialized, setBranchInitialized] = useState(false);

  useEffect(() => {
    if (user && !branchInitialized) {
      if ((user as any).adminAccess) {
        // Les admins voient toutes les boutiques par défaut
        setActiveBranchId(null);
      } else if (user.defaultBranchId) {
        setActiveBranchId(user.defaultBranchId);
      } else if (user.branchIds.length === 1) {
        setActiveBranchId(user.branchIds[0]);
      }
      // Si plusieurs branches sans défaut → null (toutes les boutiques)
      setBranchInitialized(true);
    }
  }, [user, branchInitialized]);

  useEffect(() => {
    if (isError) {
      localStorage.removeItem("erp_token");
      setTokenState(null);
    }
  }, [isError]);

  useEffect(() => {
    if (!token) {
      setLocation("/login");
    }
  }, [token, setLocation]);

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading,
        isAuthenticated: !!user,
        activeBranchId,
        setActiveBranchId,
        setToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
