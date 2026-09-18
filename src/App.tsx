import React, { useState } from 'react';
import { StudentUpload } from './components/StudentUpload';
import { TeacherMeadowView } from './components/TeacherMeadowView';
import { User, Users, Sun, Sparkles } from 'lucide-react';
import { MEADOW_BG_URL } from './assets/constants';

export default function App() {
  const [activeTab, setActiveTab] = useState<'student' | 'teacher'>('student');

  return (
    <div
      className="min-h-screen w-full relative flex flex-col font-sans"
      style={{
        backgroundImage: `linear-gradient(rgba(240, 253, 244, 0.4), rgba(240, 253, 244, 0.2)), url(${MEADOW_BG_URL})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Top Global Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-emerald-100 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo & Title */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-md">
              <Sun className="w-5 h-5 text-amber-200" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight flex items-center gap-1.5">
                동글동글 갤러리
                <span className="hidden sm:inline-block text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">
                  AI 배경 제거 & Firebase
                </span>
              </h1>
              <p className="text-[11px] text-gray-500 hidden sm:block">
                학생은 브라우저에서 배경을 지우고, 교사는 초원에서 모두를 만납니다
              </p>
            </div>
          </div>

          {/* Role Switching Tabs */}
          <div className="flex items-center bg-gray-100/90 p-1 rounded-xl border border-gray-200">
            <button
              onClick={() => setActiveTab('student')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'student'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              학생 업로드
            </button>
            <button
              onClick={() => setActiveTab('teacher')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'teacher'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              선생님 초원 모아보기
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 flex flex-col justify-center">
        {activeTab === 'student' ? (
          <div className="my-auto">
            <StudentUpload
              onSuccess={() => setActiveTab('teacher')}
              onSwitchToTeacher={() => setActiveTab('teacher')}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <TeacherMeadowView onSwitchToStudent={() => setActiveTab('student')} />
          </div>
        )}
      </main>

      {/* Clean, unobtrusive footer */}
      <footer className="py-3 text-center text-xs text-emerald-900/70 backdrop-blur-[2px]">
        초원 사진 갤러리 • 실시간 Firebase Firestore 연동 & 브라우저 인-클라이언트 배경 제거
      </footer>
    </div>
  );
}
