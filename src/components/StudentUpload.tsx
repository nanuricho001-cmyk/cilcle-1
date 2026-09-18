import React, { useState, useRef, ChangeEvent, DragEvent } from 'react';
import { 
  Upload, Sparkles, RefreshCw, CheckCircle2, 
  Send, User, MessageSquare, AlertCircle, Eye, Move
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { 
  processBackgroundRemoval, 
  BgRemovalProgress, 
  resizeImageToBlob, 
  blobToDataUrl
} from '../utils/bgRemoval';
import { db, MeadowPhoto, saveMeadowPhoto } from '../firebase';
import { MEADOW_BG_URL } from '../assets/constants';

interface StudentUploadProps {
  onSuccess?: () => void;
  onSwitchToTeacher?: () => void;
}

export const StudentUpload: React.FC<StudentUploadProps> = ({ onSuccess, onSwitchToTeacher }) => {
  const [studentName, setStudentName] = useState('');
  const [message, setMessage] = useState('');
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [removedBgImage, setRemovedBgImage] = useState<string | null>(null);
  const [uploadedFileInfo, setUploadedFileInfo] = useState<{ name: string; sizeMb: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressInfo, setProgressInfo] = useState<BgRemovalProgress | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewX, setPreviewX] = useState(50); // percentage
  const [previewY, setPreviewY] = useState(65); // percentage (on the grass)
  const [isPreviewDragging, setIsPreviewDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);

  const updatePreviewPosition = (clientX: number, clientY: number) => {
    if (!previewBoxRef.current) return;
    const rect = previewBoxRef.current.getBoundingClientRect();
    const rawX = ((clientX - rect.left) / rect.width) * 100;
    const rawY = ((clientY - rect.top) / rect.height) * 100;
    setPreviewX(Math.round(Math.max(10, Math.min(90, rawX))));
    setPreviewY(Math.round(Math.max(30, Math.min(88, rawY))));
  };

  const handlePreviewPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!removedBgImage || e.button !== 0) return;
    setIsPreviewDragging(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    updatePreviewPosition(e.clientX, e.clientY);
  };

  const handlePreviewPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPreviewDragging) return;
    updatePreviewPosition(e.clientX, e.clientY);
  };

  const handlePreviewPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsPreviewDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // Maximum file size: 35MB (supports modern high-res camera/smartphone photos)
  const MAX_FILE_SIZE_BYTES = 35 * 1024 * 1024;

  // Handle image selection
  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('이미지 파일(JPG, PNG, WEBP, HEIC 등)을 선택해주세요.');
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMsg(`사진 용량이 너무 큽니다 (현재 ${(file.size / (1024 * 1024)).toFixed(1)}MB). 최대 35MB까지 업로드 가능합니다.`);
      return;
    }

    setErrorMsg(null);
    setRemovedBgImage(null);
    setUploadedFileInfo({
      name: file.name,
      sizeMb: (file.size / (1024 * 1024)).toFixed(1),
    });

    // Read original thumbnail for preview
    const origBlob = await resizeImageToBlob(file, 800, 800);
    const origDataUrl = await blobToDataUrl(origBlob);
    setOriginalImage(origDataUrl);

    // Run client-side background removal
    setIsProcessing(true);
    setProgressInfo({
      status: 'loading_model',
      progress: 5,
      message: '고화질 배경 분리 준비 중...',
    });

    try {
      const resultDataUrl = await processBackgroundRemoval(file, (info) => {
        setProgressInfo(info);
      });
      setRemovedBgImage(resultDataUrl);
      // Randomize initial position slightly on meadow
      setPreviewX(35 + Math.floor(Math.random() * 30));
      setPreviewY(55 + Math.floor(Math.random() * 25));
    } catch (err) {
      console.error(err);
      setErrorMsg('배경 제거 처리 중 문제가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  // Submit to Firebase
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim()) {
      setErrorMsg('이름을 입력해주세요!');
      return;
    }
    if (!removedBgImage) {
      setErrorMsg('사진을 업로드하고 배경 제거를 먼저 완료해주세요.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const newPhoto: MeadowPhoto = {
        studentName: studentName.trim(),
        photoDataUrl: removedBgImage,
        createdAt: Date.now(),
        positionX: previewX,
        positionY: previewY,
        scale: previewScale,
        rotation: Math.round((Math.random() - 0.5) * 8), // slight natural tilt
      };

      if (message.trim()) {
        newPhoto.message = message.trim();
      }

      if (uploadedFileInfo?.sizeMb) {
        newPhoto.originalFileSize = parseFloat(uploadedFileInfo.sizeMb);
      }

      // Automatically handles both standard and large chunked high-res photos
      await saveMeadowPhoto(newPhoto);

      // Fireworks / confetti effect
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch {
        // ignore if confetti blocked
      }

      // Reset form
      setStudentName('');
      setMessage('');
      setOriginalImage(null);
      setRemovedBgImage(null);
      setUploadedFileInfo(null);
      setProgressInfo(null);

      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      console.error('Failed to save to Firebase:', err);
      if (err?.code === 'permission-denied' || err?.message?.includes('PERMISSION_DENIED')) {
        setErrorMsg('Firebase 권한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      } else {
        setErrorMsg(`전송 실패 (${err?.code || err?.message || '알 수 없는 오류'}): 네트워크 연결을 확인해주세요.`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto bg-white/90 backdrop-blur-md rounded-2xl shadow-xl border border-emerald-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-5 text-white flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-yellow-300" />
            내 사진을 초원에 올려보세요!
          </h2>
          <p className="text-xs text-emerald-100 mt-1">
            사진을 올리면 브라우저에서 배경을 자동으로 지워 푸른 초원에 세워줍니다.
          </p>
        </div>
        {onSwitchToTeacher && (
          <button
            type="button"
            onClick={onSwitchToTeacher}
            className="text-xs bg-white/20 hover:bg-white/30 text-white font-medium px-3.5 py-1.5 rounded-full transition flex items-center gap-1.5 border border-white/30 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            선생님 화면 보기
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-6">
        {errorMsg && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column: Student Info & Upload */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                학생 이름 <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  required
                  placeholder="예: 김민준, 이서연"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50/80 border border-gray-200 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                한 마디 인사말 / 다짐 (선택)
              </label>
              <div className="relative">
                <MessageSquare className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
                <textarea
                  rows={2}
                  placeholder="초원에 함께 모인 친구들에게 남길 말"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-gray-50/80 border border-gray-200 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition resize-none"
                />
              </div>
            </div>

            {/* Upload Zone */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                사진 선택 <span className="text-rose-500">*</span>
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition flex flex-col items-center justify-center min-h-[160px] ${
                  isDragOver
                    ? 'border-emerald-500 bg-emerald-50/70'
                    : 'border-gray-200 hover:border-emerald-400 bg-gray-50/50 hover:bg-emerald-50/20'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleInputChange}
                  accept="image/*"
                  className="hidden"
                />
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-2">
                  <Upload className="w-6 h-6" />
                </div>
                <p className="text-sm font-medium text-gray-700">
                  클릭하거나 사진을 이곳에 끌어다 놓으세요
                </p>
                <p className="text-xs text-emerald-600 font-medium mt-1">
                  ✨ 최대 35MB 고화질 지원 (스마트폰 원본 사진 가능)
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  정면 인물 사진이나 전신 사진이 가장 예쁘게 분리됩니다 (JPG, PNG, WEBP)
                </p>
                {uploadedFileInfo && (
                  <div className="mt-2.5 px-3 py-1 bg-emerald-100/70 border border-emerald-300 text-emerald-800 rounded-full text-xs font-medium flex items-center gap-1.5">
                    <span>📷 {uploadedFileInfo.name} ({uploadedFileInfo.sizeMb}MB)</span>
                  </div>
                )}
              </div>
            </div>

            {/* AI Processing Status */}
            {isProcessing && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                    {progressInfo?.message || '브라우저에서 배경 제거 중...'}
                  </span>
                  <span className="text-xs font-bold text-emerald-700">
                    {progressInfo?.progress || 0}%
                  </span>
                </div>
                <div className="w-full bg-emerald-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-emerald-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progressInfo?.progress || 10}%` }}
                  />
                </div>
                <p className="text-[11px] text-emerald-600 mt-1.5">
                  서버로 사진을 전송하지 않고 학생 기기 내 브라우저에서 안전하게 처리됩니다.
                </p>
              </div>
            )}
          </div>

          {/* Right Column: Interactive Meadow Preview */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center justify-between">
              <span>초원 배치 미리보기</span>
              {removedBgImage && (
                <span className="text-xs font-normal text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 배경 제거 완료!
                </span>
              )}
            </label>

            <div
              ref={previewBoxRef}
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={handlePreviewPointerUp}
              className={`relative w-full h-[280px] rounded-xl overflow-hidden border border-emerald-200 shadow-inner select-none touch-none ${
                removedBgImage ? (isPreviewDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
              }`}
              style={{
                backgroundImage: `url(${MEADOW_BG_URL})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {/* If no image yet */}
              {!removedBgImage && !originalImage && (
                <div className="absolute inset-0 bg-black/15 flex flex-col items-center justify-center text-white text-center p-4 backdrop-blur-[1px]">
                  <div className="bg-white/30 p-3 rounded-full mb-2">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <p className="text-sm font-medium drop-shadow">
                    사진을 올리면 이 초원에 바로 세워집니다
                  </p>
                </div>
              )}

              {/* During processing if we have original */}
              {isProcessing && originalImage && !removedBgImage && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-xs">
                  <img
                    src={originalImage}
                    alt="Original"
                    className="max-h-[75%] rounded-lg opacity-60 filter blur-xs"
                  />
                </div>
              )}

              {/* When background removed, place on meadow */}
              {removedBgImage && (
                <>
                  <div className="absolute top-2 left-2 bg-black/40 backdrop-blur-xs text-white text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5 pointer-events-none">
                    <Move className="w-3 h-3 text-emerald-300 animate-pulse" />
                    <span>초원을 클릭하거나 드래그하여 위치를 옮겨보세요</span>
                  </div>

                  <div
                    className="absolute pointer-events-none transition-transform duration-75"
                    style={{
                      left: `${previewX}%`,
                      top: `${previewY}%`,
                      transform: `translate(-50%, -85%) scale(${previewScale})`,
                    }}
                  >
                    {/* Name badge tag */}
                    {studentName && (
                      <div className="bg-white/95 text-emerald-900 text-[11px] font-bold px-2 py-0.5 rounded-full shadow-md mx-auto w-fit mb-1 border border-emerald-300 text-center whitespace-nowrap">
                        🌱 {studentName}
                      </div>
                    )}
                    {/* Persona figure */}
                    <img
                      src={removedBgImage}
                      alt="Student cutout"
                      draggable={false}
                      className="max-h-[160px] object-contain drop-shadow-[0_12px_12px_rgba(0,0,0,0.35)]"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Position and scale slider when image is ready */}
            {removedBgImage && (
              <div className="mt-3 p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs text-emerald-800">
                  <span>크기 조절:</span>
                  <input
                    type="range"
                    min="0.7"
                    max="1.4"
                    step="0.05"
                    value={previewScale}
                    onChange={(e) => setPreviewScale(parseFloat(e.target.value))}
                    className="w-32 accent-emerald-600 cursor-pointer"
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-emerald-800">
                  <span>좌우 위치:</span>
                  <input
                    type="range"
                    min="10"
                    max="90"
                    value={previewX}
                    onChange={(e) => setPreviewX(parseInt(e.target.value))}
                    className="w-32 accent-emerald-600 cursor-pointer"
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-emerald-800">
                  <span>앞뒤(상하) 위치:</span>
                  <input
                    type="range"
                    min="30"
                    max="88"
                    value={previewY}
                    onChange={(e) => setPreviewY(parseInt(e.target.value))}
                    className="w-32 accent-emerald-600 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Submit Button */}
        <div className="pt-2 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={isSubmitting || isProcessing || !removedBgImage}
            className={`px-6 py-3 rounded-xl font-bold text-white shadow-md flex items-center gap-2 transition duration-200 cursor-pointer ${
              isSubmitting || isProcessing || !removedBgImage
                ? 'bg-gray-300 cursor-not-allowed shadow-none'
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 hover:shadow-lg active:scale-98'
            }`}
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                초원에 보내는 중...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                초원에 등록하기 (선생님 화면으로 전송)
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
