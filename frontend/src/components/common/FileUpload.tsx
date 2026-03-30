import React, { useState, useCallback } from "react";
import { Upload, File, X } from "lucide-react";

interface FileUploadProps {
  onFileSelected: (file: File) => void;
  accept?: string;
  label?: string;
  maxSizeMB?: number;
}

export function FileUpload({
  onFileSelected,
  accept = "*",
  label = "Upload file",
  maxSizeMB = 10,
}: FileUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      if (file.size > maxSizeMB * 1024 * 1024) {
        setError(`File size must be under ${maxSizeMB}MB`);
        return;
      }
      setSelectedFile(file);
      onFileSelected(file);
    },
    [maxSizeMB, onFileSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) {
        handleFile(e.target.files[0]);
      }
    },
    [handleFile]
  );

  const clearFile = useCallback(() => {
    setSelectedFile(null);
    setError(null);
  }, []);

  return (
    <div>
      <label className="label">{label}</label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
          isDragging
            ? "border-brand-400 bg-brand-50"
            : "border-gray-300 hover:border-gray-400"
        }`}
      >
        {selectedFile ? (
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <File className="h-5 w-5 text-brand-500" />
            <span className="font-medium">{selectedFile.name}</span>
            <span className="text-gray-400">
              ({(selectedFile.size / 1024).toFixed(1)} KB)
            </span>
            <button
              onClick={clearFile}
              className="ml-2 rounded p-1 hover:bg-gray-100"
            >
              <X className="h-4 w-4 text-gray-400" />
            </button>
          </div>
        ) : (
          <>
            <Upload className="mb-2 h-8 w-8 text-gray-400" />
            <p className="text-sm text-gray-500">
              Drag & drop or{" "}
              <label className="cursor-pointer font-medium text-brand-600 hover:text-brand-500">
                browse
                <input
                  type="file"
                  accept={accept}
                  onChange={handleInputChange}
                  className="hidden"
                />
              </label>
            </p>
            <p className="mt-1 text-xs text-gray-400">Max {maxSizeMB}MB</p>
          </>
        )}
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
