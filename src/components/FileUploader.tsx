import React, { useCallback } from 'react';
import { Upload } from 'lucide-react';

interface FileUploaderProps {
    onFileUpload: (file: File) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onFileUpload }) => {
    const handleDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                onFileUpload(e.dataTransfer.files[0]);
            }
        },
        [onFileUpload]
    );

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onFileUpload(e.target.files[0]);
        }
    };

    return (
        <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-500 transition-colors cursor-pointer bg-gray-50"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
        >
            <input
                type="file"
                accept=".xlsx, .xls"
                className="hidden"
                id="file-upload"
                onChange={handleChange}
            />
            <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                <Upload className="w-12 h-12 text-gray-400 mb-4" />
                <p className="text-lg font-medium text-gray-700">
                    Drag & drop your Trade Blotter here
                </p>
                <p className="text-sm text-gray-500 mt-2">or click to browse</p>
            </label>
        </div>
    );
};
