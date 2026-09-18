import React, { useEffect, useState, useRef } from 'react';
import { 
  Users, Trash2, Maximize2, Download, 
  Sparkles, RefreshCw, MessageSquare, Plus,
  LayoutGrid, Compass, X, Move,
  CheckCircle2, Loader2, AlertTriangle
} from 'lucide-react';
import { db, MeadowPhoto, deleteMeadowPhoto, fetchFullPhotoDataUrl, updateMeadowPhotoPosition } from '../firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { MEADOW_BG_URL } from '../assets/constants';

interface TeacherMeadowViewProps {
  onSwitchToStudent?: () => void;
}

export const TeacherMeadowView: React.FC<TeacherMeadowViewProps> = ({ onSwitchToStudent }) => {
  const [photos, setPhotos] = useState<MeadowPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<MeadowPhoto | null>(null);
  const [fullModalImageUrl, setFullModalImageUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'meadow' | 'grid'>('meadow');
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  // Drag-and-drop photo positioning
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{
    photoId: string;
    startX: number;
    startY: number;
    hasMoved: boolean;
    currentX: number;
    currentY: number;
  } | null>(null);

  // In-app Delete Confirmation and Notification Toast
  const [deleteConfirmPhoto, setDeleteConfirmPhoto] = useState<MeadowPhoto | null>(null);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const meadowRef = useRef<HTMLDivElement>(null);

  const showNotice = (message: string, type: 'success' | 'error' = 'success') => {
    setActionNotice({ type, message });
    setTimeout(() => {
      setActionNotice(null);
    }, 3500);
  };

  // When modal photo is selected, resolve full high-res data if chunked
  useEffect(() => {
    if (selectedPhoto) {
      if (selectedPhoto.isChunked) {
        fetchFullPhotoDataUrl(selectedPhoto).then((fullUrl) => {
          setFullModalImageUrl(fullUrl);
        });
      } else {
        setFullModalImageUrl(selectedPhoto.photoDataUrl);
      }
    } else {
      setFullModalImageUrl(null);
    }
  }, [selectedPhoto]);

  // Real-time Firestore sync
  useEffect(() => {
    setLoading(true);
    setSyncError(null);
    const q = query(collection(db, 'meadow_photos'), orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const photoList: MeadowPhoto[] = [];
        snapshot.forEach((docSnap) => {
          photoList.push({
            id: docSnap.id,
            ...docSnap.data(),
          } as MeadowPhoto);
        });

        // If currently dragging a photo, keep its local moved position
        setPhotos((prev) => {
          if (dragRef.current?.photoId) {
            const curDragId = dragRef.current.photoId;
            const currentItem = prev.find((p) => p.id === curDragId);
            if (currentItem && currentItem.positionX !== undefined) {
              return photoList.map((p) =>
                p.id === curDragId
                  ? { ...p, positionX: currentItem.positionX, positionY: currentItem.positionY }
                  : p
              );
            }
          }
          return photoList;
        });

        setLoading(false);
      },
      (error) => {
        console.error('Firestore snapshot error:', error);
        setSyncError('Firebase 실시간 동기화 오류: ' + (error.message || '네트워크를 확인해주세요.'));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Handle pointer down on student photo to initiate drag or click
  const handlePointerDown = (photo: MeadowPhoto, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left click or touch
    if (!meadowRef.current || !photo.id) return;

    e.preventDefault();

    const index = photos.findIndex((p) => p.id === photo.id);
    const posX = photo.positionX !== undefined ? photo.positionX : 15 + (((index >= 0 ? index : 0) * 22) % 75);
    const posY = photo.positionY !== undefined ? photo.positionY : 58 + (((index >= 0 ? index : 0) * 13) % 28);

    dragRef.current = {
      photoId: photo.id,
      startX: e.clientX,
      startY: e.clientY,
      hasMoved: false,
      currentX: posX,
      currentY: posY,
    };

    setDraggingId(photo.id);

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !meadowRef.current) return;

    const dx = Math.abs(e.clientX - dragRef.current.startX);
    const dy = Math.abs(e.clientY - dragRef.current.startY);

    if (dx > 5 || dy > 5) {
      dragRef.current.hasMoved = true;
    }

    if (dragRef.current.hasMoved) {
      const rect = meadowRef.current.getBoundingClientRect();
      const rawX = ((e.clientX - rect.left) / rect.width) * 100;
      const rawY = ((e.clientY - rect.top) / rect.height) * 100;

      // Restrict positioning nicely within meadow boundaries
      const newX = Math.round(Math.max(4, Math.min(96, rawX)) * 10) / 10;
      const newY = Math.round(Math.max(24, Math.min(93, rawY)) * 10) / 10;

      dragRef.current.currentX = newX;
      dragRef.current.currentY = newY;

      // Realtime optimistic local update for 60fps responsiveness
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === dragRef.current?.photoId
            ? { ...p, positionX: newX, positionY: newY }
            : p
        )
      );
    }
  };

  const handlePointerUp = async (photo: MeadowPhoto, e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { hasMoved, currentX, currentY, photoId } = dragRef.current;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    dragRef.current = null;
    setDraggingId(null);

    if (!hasMoved) {
      // Regular click without dragging: open detail view
      setSelectedPhoto(photo);
      return;
    }

    // Dragged: update Firestore position
    if (photoId) {
      try {
        await updateMeadowPhotoPosition(photoId, currentX, currentY);
        showNotice(`"${photo.studentName}" 학생의 위치가 이동되었습니다.`);
      } catch (err: any) {
        console.error('Failed to update photo position:', err);
        showNotice('위치 저장 중 오류가 발생했습니다: ' + (err.message || ''), 'error');
      }
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      dragRef.current = null;
      setDraggingId(null);
    }
  };

  // Prompt single photo delete (in-app modal)
  const promptDeleteSingle = (photo: MeadowPhoto, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDeleteConfirmPhoto(photo);
  };

  // Execute confirmed deletion without browser popup blockage
  const executeConfirmedDelete = async () => {
    const targetPhoto = deleteConfirmPhoto;
    if (!targetPhoto || !targetPhoto.id) return;
    const targetId: string = targetPhoto.id;
    setIsDeleting(targetId);
    setDeleteConfirmPhoto(null);

    // Optimistic update for instant visual feedback
    setPhotos((prev) => prev.filter((p) => p.id !== targetId));
    if (selectedPhoto?.id === targetId) {
      setSelectedPhoto(null);
    }

    try {
      await deleteMeadowPhoto(targetId);
      showNotice(`"${targetPhoto.studentName}" 학생 사진이 초원에서 삭제되었습니다.`);
    } catch (err: any) {
      console.error('Delete error:', err);
      showNotice('사진 삭제 중 오류가 발생했습니다: ' + (err.message || '네트워크를 확인해주세요.'), 'error');
    } finally {
      setIsDeleting(null);
    }
  };

  // Download high-res cutout for single photo
  const handleDownload = async (photo: MeadowPhoto, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const url = photo.isChunked ? await fetchFullPhotoDataUrl(photo) : photo.photoDataUrl;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${photo.studentName}_초원사진.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="w-full h-full flex flex-col space-y-4">
      {/* Top Bar for Teacher */}
      <div className="bg-white/90 backdrop-blur-md px-6 py-4 rounded-2xl shadow-sm border border-emerald-100 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              동글동글 갤러리
              <span className="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                {photos.length}명 참여 중
              </span>
            </h1>
            <p className="text-xs text-gray-500">
              실시간으로 학생들의 배경 제거 사진이 초원에 모입니다.
            </p>
          </div>
        </div>

        {/* View Mode Toggle and Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Move Hint */}
          {viewMode === 'meadow' && photos.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-3 py-1.5 rounded-xl font-medium">
              <Move className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
              <span>사진을 클릭·드래그하여 원하는 위치로 자유롭게 이동해보세요</span>
            </div>
          )}

          {/* View Mode Buttons */}
          <div className="bg-gray-100 p-1 rounded-xl flex items-center border border-gray-200">
            <button
              onClick={() => setViewMode('meadow')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'meadow'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              초원 파노라마 뷰
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              명단 카드 뷰
            </button>
          </div>

          {onSwitchToStudent && (
            <button
              onClick={onSwitchToStudent}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition flex items-center gap-1.5 shadow-sm active:scale-98 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              학생 사진 등록하기
            </button>
          )}
        </div>
      </div>

      {/* Sync Error Notice */}
      {syncError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{syncError}</span>
          <button
            onClick={() => window.location.reload()}
            className="text-xs font-bold underline ml-3 cursor-pointer"
          >
            새로고침
          </button>
        </div>
      )}

      {/* Main View Area */}
      {viewMode === 'meadow' ? (
        /* Dynamic Meadow Panorama */
        <div
          ref={meadowRef}
          className="relative w-full min-h-[620px] flex-1 rounded-2xl overflow-hidden shadow-xl border border-emerald-200 select-none transition-all"
          style={{
            backgroundImage: `url(${MEADOW_BG_URL})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {/* Subtle Ambient Sky Gradient and Sunlight Overlay */}
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-sky-400/10 via-transparent to-emerald-950/20" />

          {/* Loading Indicator */}
          {loading && (
            <div className="absolute inset-0 bg-white/40 backdrop-blur-xs flex items-center justify-center z-20">
              <div className="bg-white px-5 py-3 rounded-2xl shadow-lg flex items-center gap-3 text-emerald-800 text-sm font-semibold">
                <RefreshCw className="w-5 h-5 animate-spin text-emerald-600" />
                초원에 학생들을 모으는 중...
              </div>
            </div>
          )}

          {/* Empty State Banner */}
          {!loading && photos.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-white/90 backdrop-blur-md p-8 rounded-2xl shadow-xl text-center max-w-md mx-4 pointer-events-auto border border-emerald-100">
                <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-gray-800 mb-1">
                  아직 초원에 모인 학생이 없습니다!
                </h3>
                <p className="text-xs text-gray-500 mb-5 leading-relaxed">
                  학생들이 사진을 업로드하면 브라우저에서 배경이 지워지고 푸른 들판 위에 나란히 등장합니다.
                </p>
                {onSwitchToStudent && (
                  <button
                    onClick={onSwitchToStudent}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow transition cursor-pointer"
                  >
                    첫 번째 학생 사진 등록하기
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Render Students in the Meadow */}
          {photos.map((photo, index) => {
            const isDragging = draggingId === photo.id;
            const posX = photo.positionX !== undefined ? photo.positionX : 15 + ((index * 22) % 75);
            const posY = photo.positionY !== undefined ? photo.positionY : 58 + ((index * 13) % 28);
            const scale = photo.scale || 1.0;
            const rot = photo.rotation || 0;
            const zIndex = isDragging ? 999 : Math.round(posY * 10);

            return (
              <div
                key={photo.id || index}
                onPointerDown={(e) => handlePointerDown(photo, e)}
                onPointerMove={handlePointerMove}
                onPointerUp={(e) => handlePointerUp(photo, e)}
                onPointerCancel={handlePointerCancel}
                className={`absolute group select-none touch-none ${
                  isDragging
                    ? 'cursor-grabbing z-[999] scale-110 drop-shadow-2xl'
                    : 'cursor-grab hover:scale-105 active:scale-95 transition-transform duration-200'
                }`}
                style={{
                  left: `${posX}%`,
                  top: `${posY}%`,
                  transform: `translate(-50%, -90%) rotate(${isDragging ? 0 : rot}deg)`,
                  zIndex: zIndex,
                }}
                title="클릭 후 드래그하여 위치 이동 / 클릭 시 사진 상세 보기"
              >
                {/* Speech bubble / message preview on hover (hidden while dragging) */}
                {!isDragging && photo.message && (
                  <div className="opacity-0 group-hover:opacity-100 transition duration-200 pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 bg-white/95 text-gray-800 text-xs px-3 py-1.5 rounded-xl shadow-lg border border-emerald-200 whitespace-nowrap z-30">
                    <p className="font-medium">"{photo.message}"</p>
                    <div className="w-2 h-2 bg-white border-r border-b border-emerald-200 transform rotate-45 mx-auto -mb-1" />
                  </div>
                )}

                {/* Clean Name Pill on Top with Move Icon */}
                <div
                  className={`mx-auto w-fit mb-1 px-2.5 py-1 rounded-full shadow-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                    isDragging
                      ? 'bg-emerald-600 text-white ring-2 ring-emerald-300 scale-105 shadow-emerald-500/50'
                      : 'bg-white/95 text-emerald-900 border border-emerald-300'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${isDragging ? 'bg-white animate-ping' : 'bg-emerald-500 animate-pulse'}`} />
                  <span>{photo.studentName}</span>
                  <Move className={`w-3 h-3 ${isDragging ? 'text-emerald-100' : 'text-emerald-600 opacity-60 group-hover:opacity-100 transition'}`} />
                </div>

                {/* Cutout Body with realistic grass grounding shadow */}
                <div className="relative transition-all duration-200">
                  <img
                    src={photo.photoDataUrl}
                    alt={photo.studentName}
                    draggable={false}
                    style={{ transform: `scale(${scale})` }}
                    className={`max-h-[190px] md:max-h-[230px] object-contain select-none filter contrast-[1.03] saturate-[1.05] ${
                      isDragging
                        ? 'drop-shadow-[0_24px_22px_rgba(0,0,0,0.55)] brightness-105'
                        : 'drop-shadow-[0_16px_14px_rgba(0,0,0,0.42)]'
                    }`}
                  />
                  {/* Subtle feet grass contact shadow */}
                  <div
                    className={`h-3 bg-black/25 rounded-full filter blur-[3px] mx-auto -mt-2 transition-all duration-200 ${
                      isDragging ? 'w-[85%] scale-125 opacity-70' : 'w-3/4'
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Grid Card View for Easy Grading / Reviewing */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {photos.map((photo) => {
            return (
              <div
                key={photo.id}
                onClick={() => setSelectedPhoto(photo)}
                className="bg-white/90 backdrop-blur-md rounded-2xl p-4 border border-emerald-100 shadow-sm hover:shadow-md transition cursor-pointer flex flex-col group relative"
              >
                {/* Meadow mini preview box */}
                <div
                  className="w-full h-44 rounded-xl overflow-hidden mb-3 relative flex items-center justify-center"
                  style={{
                    backgroundImage: `url(${MEADOW_BG_URL})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  <img
                    src={photo.photoDataUrl}
                    alt={photo.studentName}
                    className="max-h-[85%] object-contain drop-shadow-md transition group-hover:scale-105"
                  />
                </div>

                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                      {photo.studentName}
                    </h4>
                    <span className="text-[10px] text-gray-400">
                      {new Date(photo.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {photo.message && (
                    <p className="text-xs text-gray-600 mt-1 line-clamp-2 italic">
                      "{photo.message}"
                    </p>
                  )}
                </div>

                {/* Card Action Buttons */}
                <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                  <button
                    onClick={(e) => handleDownload(photo, e)}
                    className="hover:text-emerald-600 transition flex items-center gap-1 cursor-pointer font-medium"
                    title="PNG 다운로드"
                  >
                    <Download className="w-3.5 h-3.5" /> 저장
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPhoto(photo);
                    }}
                    className="hover:text-gray-700 transition flex items-center gap-1 cursor-pointer"
                    title="자세히 보기"
                  >
                    <Maximize2 className="w-3.5 h-3.5" /> 확대
                  </button>

                  {photo.id && (
                    <button
                      onClick={(e) => promptDeleteSingle(photo, e)}
                      disabled={isDeleting === photo.id}
                      className="hover:text-rose-600 transition flex items-center gap-1 cursor-pointer"
                      title="삭제"
                    >
                      {isDeleting === photo.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      삭제
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Student Modal Details */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-emerald-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 bg-emerald-600 text-white flex items-center justify-between">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-yellow-300" />
                {selectedPhoto.studentName} 학생의 사진
              </h3>
              <button
                onClick={() => setSelectedPhoto(null)}
                className="text-white/80 hover:text-white p-1 rounded-lg transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <div
                className="w-full h-64 rounded-xl overflow-hidden flex items-center justify-center relative shadow-inner mb-4"
                style={{
                  backgroundImage: `url(${MEADOW_BG_URL})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                <img
                  src={fullModalImageUrl || selectedPhoto.photoDataUrl}
                  alt={selectedPhoto.studentName}
                  className="max-h-[85%] object-contain drop-shadow-xl transition-all duration-300"
                />
              </div>

              {selectedPhoto.message && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 mb-4">
                  <div className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5 mb-1">
                    <MessageSquare className="w-3.5 h-3.5" /> 남긴 메시지
                  </div>
                  <p className="text-sm text-emerald-950">{selectedPhoto.message}</p>
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-100">
                <span>등록일시: {new Date(selectedPhoto.createdAt).toLocaleString()}</span>
                
                <div className="flex items-center gap-2">
                  {/* Single Download */}
                  <button
                    onClick={(e) => handleDownload(selectedPhoto, e)}
                    className="px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-semibold rounded-lg flex items-center gap-1 transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> PNG 저장
                  </button>

                  {/* Single Delete */}
                  {selectedPhoto.id && (
                    <button
                      onClick={(e) => promptDeleteSingle(selectedPhoto, e)}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded-lg flex items-center gap-1 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> 삭제
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* In-App Delete Confirmation Modal (Reliable across all iframes and devices) */}
      {deleteConfirmPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => {
            if (!isDeleting) setDeleteConfirmPhoto(null);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-rose-100 transform transition-all animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-4 shadow-sm">
              <Trash2 className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-gray-900 text-center mb-1.5">
              사진 삭제
            </h3>

            <p className="text-xs text-gray-600 text-center mb-5 leading-relaxed">
              <strong className="text-gray-900 font-bold">
                "{deleteConfirmPhoto.studentName}"
              </strong> 학생의 사진을 초원에서 삭제하시겠습니까?
              <span className="text-[11px] text-rose-600 font-medium block mt-1">
                * 삭제된 사진은 초원에서 즉시 제거되며 복구할 수 없습니다.
              </span>
            </p>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteConfirmPhoto(null)}
                disabled={!!isDeleting}
                className="flex-1 py-2.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs rounded-xl transition cursor-pointer disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={executeConfirmedDelete}
                disabled={!!isDeleting}
                className="flex-1 py-2.5 px-3 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>삭제 중...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>삭제하기</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App Action Notification Toast */}
      {actionNotice && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl border flex items-center gap-2.5 text-xs font-bold animate-in fade-in slide-in-from-bottom-3 duration-200 ${
            actionNotice.type === 'success'
              ? 'bg-emerald-800 text-white border-emerald-600'
              : 'bg-rose-800 text-white border-rose-600'
          }`}
        >
          {actionNotice.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0" />
          )}
          <span>{actionNotice.message}</span>
        </div>
      )}
    </div>
  );
};

