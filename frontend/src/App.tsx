import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { WalletProvider } from "./contexts/WalletContext";
import { ContractProvider } from "./contexts/ContractContext";
import { Layout } from "./components/layout/Layout";
import Dashboard from "./pages/Dashboard";
import BrowseJobs from "./pages/BrowseJobs";
import PostJob from "./pages/PostJob";
import JobDetail from "./pages/JobDetail";
import ApplyJob from "./pages/ApplyJob";
import DisputeDetail from "./pages/DisputeDetail";
import Profile from "./pages/Profile";
import Wallet from "./pages/Wallet";
import Admin from "./pages/Admin";
import Judge from "./pages/JudgeDispute";

function NotFound() {
  return (
    <div className="text-center py-20">
      <h1 className="text-4xl font-bold text-gray-300 mb-4">404</h1>
      <p className="text-gray-500 mb-6">Page not found.</p>
      <a href="/" className="text-brand-600 hover:underline">
        Back to Dashboard
      </a>
    </div>
  );
}

export default function App({ appName }: { appName: string }) {
  return (
    <BrowserRouter>
      <WalletProvider>
        <ContractProvider>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 5000,
              style: {
                borderRadius: "8px",
                background: "#fff",
                color: "#1f2937",
                fontSize: "14px",
                boxShadow:
                  "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
              },
            }}
          />
          <Routes>
            <Route element={<Layout appName={appName} />}>
              <Route path="/" element={<Dashboard appName={appName} />} />
              <Route path="/browse" element={<BrowseJobs />} />
              <Route path="/post-job" element={<PostJob />} />
              <Route path="/job/:id" element={<JobDetail />} />
              <Route path="/apply/:id" element={<ApplyJob />} />
              <Route
                path="/dispute/:jobId/:milestoneIdx"
                element={<DisputeDetail />}
              />
              <Route path="/judge" element={<Judge />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/:address" element={<Profile />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </ContractProvider>
      </WalletProvider>
    </BrowserRouter>
  );
}
