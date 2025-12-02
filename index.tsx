import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type, Schema } from "@google/genai";

// --- Types ---

type MondaiId = 
  | "vocab_readings"    // P1
  | "vocab_context"     // P2
  | "vocab_paraphrase"  // P3
  | "vocab_usage"       // P4
  | "grammar_selection" // P5
  | "grammar_order"     // P6
  | "reading_short"     // P8 (New)
  | "reading_medium"    // P9 (New)
  | "review_mistakes";  // Review Mode

interface MondaiConfig {
  id: MondaiId;
  section: "Vocabulary" | "Grammar" | "Reading" | "Review";
  label: string;
  subLabel: string;
  count: number;
  description: string;
}

const MONDAI_LIST: MondaiConfig[] = [
  { id: "vocab_readings", section: "Vocabulary", label: "問題1 漢字読み", subLabel: "Kanji Readings", count: 6, description: "Select the correct reading for the underlined word." },
  { id: "vocab_context", section: "Vocabulary", label: "問題2 文脈規定", subLabel: "Context", count: 7, description: "Fill in the blank with the most appropriate word." },
  { id: "vocab_paraphrase", section: "Vocabulary", label: "問題3 言い換え", subLabel: "Paraphrases", count: 6, description: "Select the word closest in meaning." },
  { id: "vocab_usage", section: "Vocabulary", label: "問題4 用法", subLabel: "Usage", count: 6, description: "Select the sentence that uses the word correctly." },
  { id: "grammar_selection", section: "Grammar", label: "問題5 文法形式", subLabel: "Grammar", count: 10, description: "Select the correct grammar form." },
  { id: "grammar_order", section: "Grammar", label: "問題6 並べ替え", subLabel: "Composition", count: 5, description: "Choose the item that fits in the ★ position." },
  { id: "reading_short", section: "Reading", label: "問題8 短文", subLabel: "Short Passage", count: 4, description: "Read a short text (~200 chars) and answer the question." },
  { id: "reading_medium", section: "Reading", label: "問題9 中文", subLabel: "Medium Passage", count: 3, description: "Read a medium text (~500 chars) and answer the question." },
];

interface Question {
  id: string; // Unique ID for deduplication
  question: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
  categoryLabel?: string; // To track where the mistake came from
  timestamp?: number;
}

type AppState = "menu" | "loading" | "quiz" | "results" | "error";

// --- Helper Functions ---

const shuffleOptions = (questions: any[]): Question[] => {
  return questions.map((q) => {
    // Create an array of objects to track original values and indices
    const optionsWithIndices = q.options.map((opt: string, index: number) => ({
      opt,
      originalIndex: index,
    }));

    // Shuffle the array
    for (let i = optionsWithIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [optionsWithIndices[i], optionsWithIndices[j]] = [optionsWithIndices[j], optionsWithIndices[i]];
    }

    // Extract shuffled options and find new correct index
    const shuffledOptions = optionsWithIndices.map((o: any) => o.opt);
    const newCorrectIndex = optionsWithIndices.findIndex((o: any) => o.originalIndex === q.correctAnswerIndex);

    return {
      ...q,
      options: shuffledOptions,
      correctAnswerIndex: newCorrectIndex,
    };
  });
};

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// --- API Logic ---

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const generateQuestions = async (config: MondaiConfig): Promise<Question[]> => {
  let specificPrompt = "";
  
  // Prompts updated to explicitly request HTML formatting for underlines and blanks to ensure visibility
  switch (config.id) {
    case "vocab_readings":
      specificPrompt = `Generate ${config.count} JLPT N1 "Kanji Reading" (Problem 1) questions. 
      Format: A sentence with a complex N1 Kanji word underlined. 
      CRITICAL VISUAL REQUIREMENT: Wrap the target kanji word in <span class="border-b-2 border-stone-800 font-bold px-1">word</span> so the underline is clearly visible. Do NOT use simple <u> tags.
      Options: 4 Hiragana reading choices. Distractors should be very similar readings.`;
      break;
    case "vocab_context":
      specificPrompt = `Generate ${config.count} JLPT N1 "Context" (Problem 2) questions. 
      Format: A sentence with a blank represented exactly by "(　　　)".
      Options: 4 N1 vocabulary words. Only one fits the context.`;
      break;
    case "vocab_paraphrase":
      specificPrompt = `Generate ${config.count} JLPT N1 "Paraphrase" (Problem 3) questions. 
      Format: A sentence with an N1 word underlined. 
      CRITICAL VISUAL REQUIREMENT: Wrap the target word in <span class="border-b-2 border-stone-800 font-bold px-1">word</span>.
      Options: 4 words or phrases. Choose the one with the closest meaning to the underlined part.`;
      break;
    case "vocab_usage":
      specificPrompt = `Generate ${config.count} JLPT N1 "Usage" (Problem 4) questions. 
      Format: The question text is just the Target Word (e.g., "【手際】"). 
      Options: 4 full sentences using the word. Only one sentence uses the word naturally and correctly.`;
      break;
    case "grammar_selection":
      specificPrompt = `Generate ${config.count} JLPT N1 "Grammar Selection" (Problem 5) questions. 
      Format: A sentence with a missing grammar part.
      CRITICAL VISUAL REQUIREMENT: Represent the blank exactly as "(　　　)". Do not use underscores.
      Options: 4 N1 grammar points.`;
      break;
    case "grammar_order":
      specificPrompt = `Generate ${config.count} JLPT N1 "Sentence Composition" (Problem 6) questions. 
      Format: A sentence with 4 blanks, one marked with a star (★). 
      CRITICAL VISUAL REQUIREMENT: Use exactly this format for the blanks in the sentence: "<span class='border-b border-stone-400 inline-block w-8 mx-1'></span> <span class='border-b border-stone-400 inline-block w-8 mx-1'></span> <span class='border-b border-stone-800 font-bold inline-block w-8 mx-1 text-center'>★</span> <span class='border-b border-stone-400 inline-block w-8 mx-1'></span>".
      Example: "私 <span class='border-b border-stone-400 inline-block w-8 mx-1'></span> <span class='border-b border-stone-400 inline-block w-8 mx-1'></span> <span class='border-b border-stone-800 font-bold inline-block w-8 mx-1 text-center'>★</span> <span class='border-b border-stone-400 inline-block w-8 mx-1'></span> です。"
      Options: 4 words or fragments to fill the blanks. 
      Correct Answer: The index of the option that goes in the ★ position. 
      Explanation: Explain the correct full sentence order.`;
      break;
    case "reading_short":
      specificPrompt = `Generate ${config.count} JLPT N1 "Short Passage Reading" (Problem 8) questions.
      Format: 
      1. Create an N1-level short reading passage (about 200 Japanese characters) on topics like philosophy, society, or essays.
      2. Create one question based on the passage (e.g., "What is the author's main point?" or "Why did X happen?").
      3. In the JSON 'question' field, combine the passage and the question using HTML. Wrap the passage in <div class='bg-stone-100 p-4 rounded-lg mb-4 text-sm leading-loose font-serif text-stone-700'>...passage...</div> and put the question text in <p class='font-bold text-lg'>...question...</p>.`;
      break;
    case "reading_medium":
      specificPrompt = `Generate ${config.count} JLPT N1 "Medium Passage Reading" (Problem 9) questions.
      Format:
      1. Create an N1-level medium reading passage (about 400-500 Japanese characters). Topic: Editorial, critique, or abstract essay.
      2. Create one deeper comprehension question (e.g., content relationship, author's stance).
      3. In the JSON 'question' field, combine the passage and the question using HTML. Wrap the passage in <div class='bg-stone-100 p-4 rounded-lg mb-4 text-xs md:text-sm leading-loose font-serif text-stone-700'>...passage...</div> and put the question text in <p class='font-bold text-lg'>...question...</p>.`;
      break;
    default:
      throw new Error("Invalid config for API generation");
  }

  const prompt = `
    ${specificPrompt}
    
    IMPORTANT: 
    1. Strictly follow the JLPT N1 difficulty level. 
    2. PRIORITIZE questions that have appeared in actual past exams (2010-2024). 
    3. If exact past questions are restricted, generate questions that are indistinguishable from real exam questions in style, tone, and difficulty.
    4. Provide a detailed explanation in Japanese.
  `;

  // Wrapped schema in an object "response" to avoid top-level array issues
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      questions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING, description: "The question text (can include HTML)." },
            options: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING }
            },
            correctAnswerIndex: { type: Type.INTEGER, description: "0-3 index." },
            explanation: { type: Type.STRING },
          },
          required: ["question", "options", "correctAnswerIndex", "explanation"],
        }
      }
    }
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are a professional JLPT Exam creator. Output valid JSON.",
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    if (response.text) {
      const parsed = JSON.parse(response.text);
      // Map to add IDs and Category
      const rawQuestions = parsed.questions || parsed; // Handle potential schema variance
      if (Array.isArray(rawQuestions)) {
        // Shuffle options here to ensure randomness and avoid model bias
        const randomizedQuestions = shuffleOptions(rawQuestions);
        
        return randomizedQuestions.map((q: any) => ({
          ...q,
          id: `${config.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          categoryLabel: config.label,
          timestamp: Date.now()
        }));
      }
    }
    throw new Error("No data returned");
  } catch (error) {
    console.error("Error generating questions:", error);
    throw error;
  }
};

// --- Components ---

const Menu = ({ 
  onSelect, 
  mistakeCount, 
  onReviewMistakes 
}: { 
  onSelect: (c: MondaiConfig) => void, 
  mistakeCount: number,
  onReviewMistakes: () => void
}) => {
  const vocabItems = MONDAI_LIST.filter(m => m.section === "Vocabulary");
  const grammarItems = MONDAI_LIST.filter(m => m.section === "Grammar");
  const readingItems = MONDAI_LIST.filter(m => m.section === "Reading");

  const Section = ({ title, items, color }: { title: string, items: MondaiConfig[], color: string }) => (
    <div className="mb-8">
      <h2 className={`text-xl font-bold mb-4 flex items-center ${color}`}>
        <span className="w-2 h-6 rounded mr-2 bg-current"></span>
        {title}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((item) => (
          <button 
            key={item.id}
            onClick={() => onSelect(item)}
            className="group relative flex flex-col items-start p-5 bg-white border border-stone-200 hover:border-stone-400 rounded-xl transition-all duration-200 shadow-sm hover:shadow-md text-left"
          >
            <div className="flex justify-between w-full mb-1">
              <span className="font-bold text-stone-800 text-lg group-hover:text-indigo-700">{item.label}</span>
              <span className="text-xs font-mono bg-stone-100 px-2 py-1 rounded text-stone-500 group-hover:bg-indigo-50 group-hover:text-indigo-600">
                {item.count}問
              </span>
            </div>
            <span className="text-sm text-stone-500 font-medium">{item.subLabel}</span>
            <span className="text-xs text-stone-400 mt-2 line-clamp-1">{item.description}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-stone-50 p-6 font-sans">
      <div className="max-w-4xl mx-auto">
        <div className="bg-indigo-900 text-white p-8 rounded-2xl shadow-lg mb-8 text-center relative overflow-hidden">
          <div className="relative z-10">
            <h1 className="text-3xl font-bold mb-2">JLPT N1 直前対策</h1>
            <p className="text-indigo-200">Official Exam Structure Practice</p>
          </div>
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <svg className="w-32 h-32 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2.5-1.25L12 8.5l-2.5 1.25L12 11zm0 2.5l-5-2.5-5 2.5L12 22l10-8.5-5-2.5-5 2.5z"/></svg>
          </div>
        </div>

        {/* Mistake Bank Card */}
        <div className="mb-8">
           <h2 className="text-xl font-bold mb-4 flex items-center text-rose-700">
            <span className="w-2 h-6 rounded mr-2 bg-current"></span>
            弱点克服 (Mistake Bank)
          </h2>
          <button 
            onClick={onReviewMistakes}
            disabled={mistakeCount === 0}
            className={`w-full flex items-center justify-between p-6 rounded-xl border-2 transition-all duration-200 shadow-sm ${
              mistakeCount > 0 
                ? 'bg-white border-rose-200 hover:border-rose-400 hover:shadow-md cursor-pointer' 
                : 'bg-stone-100 border-stone-200 opacity-70 cursor-not-allowed'
            }`}
          >
            <div className="flex items-center">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mr-4 ${mistakeCount > 0 ? 'bg-rose-100 text-rose-600' : 'bg-stone-200 text-stone-400'}`}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </div>
              <div className="text-left">
                <span className={`block font-bold text-lg ${mistakeCount > 0 ? 'text-rose-700' : 'text-stone-500'}`}>
                  間違えた問題を復習する
                </span>
                <span className="text-sm text-stone-500">Review your incorrect answers</span>
              </div>
            </div>
            <div className="flex items-center">
              <span className={`text-2xl font-bold mr-2 ${mistakeCount > 0 ? 'text-rose-600' : 'text-stone-400'}`}>
                {mistakeCount}
              </span>
              <span className="text-stone-400 text-sm">問</span>
            </div>
          </button>
        </div>

        <Section title="言語知識 (文字・語彙)" items={vocabItems} color="text-indigo-700" />
        <Section title="言語知識 (文法)" items={grammarItems} color="text-emerald-700" />
        <Section title="読解 (Reading)" items={readingItems} color="text-amber-700" />

        <div className="text-center text-xs text-stone-400 mt-8">
          Generated by Gemini 2.5 Flash | Targets N1 Level (2010-2024 Criteria)
        </div>
      </div>
    </div>
  );
};

const Loading = () => (
  <div className="flex flex-col items-center justify-center min-h-screen bg-stone-50 text-stone-600">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
    <p className="animate-pulse font-medium">過去問データベースから抽出中...</p>
    <p className="text-xs text-stone-400 mt-2">Accessing exam patterns & filtering duplicates...</p>
  </div>
);

const ErrorView = ({ onRetry }: { onRetry: () => void }) => (
  <div className="flex flex-col items-center justify-center min-h-screen bg-stone-50 p-6">
    <div className="bg-red-50 text-red-800 p-8 rounded-xl max-w-sm text-center border border-red-200 shadow-sm">
      <h3 className="font-bold text-lg mb-2">生成エラー</h3>
      <p className="text-sm mb-6">問題の作成に失敗しました。もう一度お試しください。</p>
      <button 
        onClick={onRetry}
        className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-bold"
      >
        再試行 (Retry)
      </button>
    </div>
  </div>
);

const Quiz = ({ 
  questions, 
  config,
  onFinish,
  onAnswerReport
}: { 
  questions: Question[], 
  config: MondaiConfig,
  onFinish: (score: number, total: number, timeSpent: number) => void,
  onAnswerReport: (question: Question, isCorrect: boolean) => void
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isChecked, setIsChecked] = useState(false);
  const [score, setScore] = useState(0);
  const [seconds, setSeconds] = useState(0);

  // Timer logic
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const currentQ = questions[currentIndex];
  // Handle case where questions might be empty due to aggressive filtering (edge case)
  if (!currentQ) {
      return <div className="p-8 text-center">No questions available. Please return to menu.</div>;
  }

  const isLastQuestion = currentIndex === questions.length - 1;

  // Handle auto-scroll to explanation when checking
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isChecked) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isChecked]);

  const handleOptionClick = (index: number) => {
    if (isChecked) return;
    setSelectedOption(index);
  };

  const handleCheck = () => {
    if (selectedOption === null) return;
    
    const isCorrect = selectedOption === currentQ.correctAnswerIndex;
    setIsChecked(true);
    
    if (isCorrect) {
      setScore(s => s + 1);
    }

    // Report answer to App for Mistake Bank logic
    onAnswerReport(currentQ, isCorrect);
  };

  const handleNext = () => {
    if (!isLastQuestion) {
      setCurrentIndex(prev => prev + 1);
      setSelectedOption(null);
      setIsChecked(false);
    } else {
      onFinish(score + (selectedOption === currentQ.correctAnswerIndex ? 0 : 0), questions.length, seconds); 
    }
  };

  const progress = ((currentIndex + 1) / questions.length) * 100;

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center py-6 px-4 font-sans md:py-12">
      {/* Header */}
      <div className="w-full max-w-2xl mb-8">
        <div className="flex justify-between items-end mb-2">
          <div>
            <span className={`text-xs font-bold px-2 py-1 rounded uppercase tracking-wider ${config.id === 'review_mistakes' ? 'bg-rose-100 text-rose-700' : 'bg-indigo-50 text-indigo-600'}`}>
              {config.label}
            </span>
            <span className="text-xs text-stone-400 ml-2">{config.subLabel}</span>
          </div>
          <div className="flex items-center gap-4">
             {/* Timer Display */}
            <div className="flex items-center text-stone-500 font-mono text-sm bg-white px-2 py-1 rounded border border-stone-200 shadow-sm">
                <svg className="w-4 h-4 mr-1 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {formatTime(seconds)}
            </div>
            <span className="text-sm font-bold text-stone-600">
                {currentIndex + 1} <span className="text-stone-300">/</span> {questions.length}
            </span>
          </div>
        </div>
        <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-300 ${config.id === 'review_mistakes' ? 'bg-rose-500' : 'bg-indigo-600'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question Card */}
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden mb-6">
        {currentQ.categoryLabel && config.id === 'review_mistakes' && (
           <div className="bg-stone-50 px-6 py-2 border-b border-stone-100 text-xs text-stone-400 flex items-center">
             <span className="w-1.5 h-1.5 rounded-full bg-stone-300 mr-2"></span>
             Original: {currentQ.categoryLabel}
           </div>
        )}
        <div className="p-6 md:p-10 border-b border-stone-100">
          <h2 
            className="text-xl md:text-2xl font-bold text-stone-800 leading-relaxed whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: currentQ.question }}
          />
        </div>

        {/* Options */}
        <div className="p-6 md:p-8 grid grid-cols-1 gap-3">
          {currentQ.options.map((option, idx) => {
            let baseStyle = "p-4 rounded-xl border-2 text-left transition-all duration-200 flex items-center ";
            
            if (isChecked) {
              if (idx === currentQ.correctAnswerIndex) {
                baseStyle += "bg-green-50 border-green-500 text-green-900 font-bold";
              } else if (idx === selectedOption && idx !== currentQ.correctAnswerIndex) {
                baseStyle += "bg-red-50 border-red-500 text-red-900 opacity-60";
              } else {
                baseStyle += "bg-stone-50 border-transparent text-stone-400 opacity-40";
              }
            } else {
              if (selectedOption === idx) {
                baseStyle += "bg-indigo-50 border-indigo-600 text-indigo-900 shadow-md ring-1 ring-indigo-200";
              } else {
                baseStyle += "bg-white border-stone-200 text-stone-700 hover:border-indigo-400 hover:bg-stone-50";
              }
            }

            return (
              <button
                key={idx}
                onClick={() => handleOptionClick(idx)}
                disabled={isChecked}
                className={baseStyle}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center mr-4 text-xs font-bold border shrink-0 ${
                  isChecked && idx === currentQ.correctAnswerIndex ? 'bg-green-500 border-green-500 text-white' :
                  isChecked && idx === selectedOption ? 'bg-red-500 border-red-500 text-white' :
                  selectedOption === idx ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-stone-300 text-stone-400'
                }`}>
                  {idx + 1}
                </div>
                <span className="text-base md:text-lg">{option}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer / Controls */}
      <div className="w-full max-w-2xl mb-12">
        {!isChecked ? (
          <button
            onClick={handleCheck}
            disabled={selectedOption === null}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all duration-200 shadow-sm ${
              selectedOption === null 
                ? 'bg-stone-200 text-stone-400 cursor-not-allowed' 
                : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md transform active:scale-[0.99]'
            }`}
          >
            回答する (Answer)
          </button>
        ) : (
          <div className="bg-white rounded-xl shadow-lg border-l-4 border-indigo-500 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300" ref={bottomRef}>
            <div className="p-6">
              <div className="flex items-center mb-3">
                {selectedOption === currentQ.correctAnswerIndex ? (
                  <span className="flex items-center text-green-600 font-bold text-lg">
                    <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    正解！
                  </span>
                ) : (
                  <span className="flex items-center text-red-500 font-bold text-lg">
                    <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    不正解
                  </span>
                )}
                {config.id === 'review_mistakes' && selectedOption === currentQ.correctAnswerIndex && (
                   <span className="ml-auto text-xs bg-rose-100 text-rose-600 px-2 py-1 rounded">錯題集から削除しました</span>
                )}
              </div>
              <p className="text-stone-600 leading-relaxed text-sm md:text-base whitespace-pre-wrap">
                {currentQ.explanation}
              </p>
            </div>
            <div className="bg-stone-50 p-4 flex justify-end">
              <button
                onClick={handleNext}
                className="px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition shadow-sm flex items-center"
              >
                {isLastQuestion ? "結果を見る" : "次へ"}
                <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Results = ({ 
  score, 
  total, 
  timeSpent,
  onRestart 
}: { 
  score: number, 
  total: number, 
  timeSpent: number,
  onRestart: () => void 
}) => {
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
  
  let message = "";
  if (percentage === 100) message = "完璧です！合格間違いなし！";
  else if (percentage >= 80) message = "素晴らしい！合格圏内です。";
  else if (percentage >= 60) message = "あと少し！苦手を克服しましょう。";
  else message = "基礎から復習しましょう。";

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="bg-white p-10 rounded-2xl shadow-xl max-w-md w-full border border-stone-100">
        <h2 className="text-2xl font-bold text-stone-800 mb-2">練習結果</h2>
        
        <div className="relative w-48 h-48 mx-auto my-8 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90">
            <circle cx="96" cy="96" r="88" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-stone-100" />
            <circle 
              cx="96" cy="96" r="88" 
              stroke="currentColor" 
              strokeWidth="12" 
              fill="transparent" 
              className={`text-indigo-600 transition-all duration-1000 ease-out`}
              strokeDasharray={552} // 2 * pi * 88
              strokeDashoffset={552 - (552 * percentage) / 100}
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span className="text-5xl font-bold text-stone-800">{score}</span>
            <span className="text-stone-400 text-xl font-medium">/ {total}</span>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4">
           <div className="bg-stone-50 p-3 rounded-lg">
             <span className="block text-xs text-stone-400 uppercase tracking-wide">正答率</span>
             <span className="font-bold text-lg text-stone-700">{percentage}%</span>
           </div>
           <div className="bg-stone-50 p-3 rounded-lg">
             <span className="block text-xs text-stone-400 uppercase tracking-wide">タイム</span>
             <span className="font-bold text-lg text-stone-700">{formatTime(timeSpent)}</span>
           </div>
        </div>

        <div className="mb-8">
           <p className="text-lg font-bold text-indigo-900">{message}</p>
        </div>

        <button 
          onClick={onRestart}
          className="w-full py-4 bg-stone-800 text-white rounded-xl font-bold hover:bg-stone-900 transition shadow-lg flex items-center justify-center"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          メニューに戻る
        </button>
      </div>
    </div>
  );
};

// --- Main App ---

const STORAGE_KEY_MISTAKES = "jlpt_n1_mistakes";
const STORAGE_KEY_MASTERED = "jlpt_n1_mastered";

export default function App() {
  const [appState, setAppState] = useState<AppState>("menu");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [finalScore, setFinalScore] = useState(0);
  const [finalTime, setFinalTime] = useState(0);
  const [activeConfig, setActiveConfig] = useState<MondaiConfig | null>(null);
  const [mistakeBank, setMistakeBank] = useState<Question[]>([]);
  const [masteredBank, setMasteredBank] = useState<string[]>([]); // Array of question text

  // Load storage on mount
  useEffect(() => {
    try {
      const storedMistakes = localStorage.getItem(STORAGE_KEY_MISTAKES);
      if (storedMistakes) {
        setMistakeBank(JSON.parse(storedMistakes));
      }
      
      const storedMastered = localStorage.getItem(STORAGE_KEY_MASTERED);
      if (storedMastered) {
        setMasteredBank(JSON.parse(storedMastered));
      }
    } catch (e) {
      console.error("Failed to load storage", e);
    }
  }, []);

  const saveMistakes = (newMistakes: Question[]) => {
    setMistakeBank(newMistakes);
    localStorage.setItem(STORAGE_KEY_MISTAKES, JSON.stringify(newMistakes));
  };

  const saveMastered = (newMastered: string[]) => {
    setMasteredBank(newMastered);
    localStorage.setItem(STORAGE_KEY_MASTERED, JSON.stringify(newMastered));
  };

  const handleAnswerReport = (question: Question, isCorrect: boolean) => {
    if (activeConfig?.id === 'review_mistakes') {
      // Review Mode: If correct, remove from mistakes AND add to mastered
      if (isCorrect) {
        const updated = mistakeBank.filter(q => q.id !== question.id);
        saveMistakes(updated);
        
        // Add to mastered so it doesn't appear in normal rotation either
        if (!masteredBank.includes(question.question)) {
          saveMastered([...masteredBank, question.question]);
        }
      }
    } else {
      // Normal Mode
      if (!isCorrect) {
        // If wrong, add to mistakes
        const exists = mistakeBank.some(q => q.question === question.question);
        if (!exists) {
          saveMistakes([...mistakeBank, question]);
        }
      } else {
        // If correct, add to mastered
        if (!masteredBank.includes(question.question)) {
          saveMastered([...masteredBank, question.question]);
        }
      }
    }
  };

  const startQuiz = async (config: MondaiConfig) => {
    setActiveConfig(config);
    setAppState("loading");
    
    // Check if it's review mode
    if (config.id === 'review_mistakes') {
       if (mistakeBank.length === 0) {
         setAppState("menu");
         return;
       }
       // Shuffle mistakes for review
       const shuffled = shuffleOptions([...mistakeBank].sort(() => 0.5 - Math.random()));
       setQuestions(shuffled);
       setAppState("quiz");
       return;
    }

    try {
      const qs = await generateQuestions(config);
      
      // Filter out questions that are in the Mastered Bank
      const freshQuestions = qs.filter(q => !masteredBank.includes(q.question));
      
      if (freshQuestions.length === 0 && qs.length > 0) {
        // Edge case: All questions returned were already mastered.
        console.warn("All generated questions were previously mastered. Showing anyway.");
        setQuestions(qs);
      } else {
        setQuestions(freshQuestions);
      }
      
      setAppState("quiz");
    } catch (e) {
      setAppState("error");
    }
  };

  const startReviewMistakes = () => {
    const config: MondaiConfig = {
      id: "review_mistakes",
      section: "Review",
      label: "錯題集・復習",
      subLabel: "Review Mistakes",
      count: mistakeBank.length,
      description: "Stored incorrect answers"
    };
    startQuiz(config);
  };

  const handleFinish = (score: number, total: number, timeSpent: number) => {
    setFinalScore(score);
    setFinalTime(timeSpent);
    setAppState("results");
  };

  const handleRestart = () => {
    setAppState("menu");
    setQuestions([]);
    setFinalScore(0);
    setFinalTime(0);
    setActiveConfig(null);
  };

  return (
    <>
      {appState === "menu" && (
        <Menu 
          onSelect={startQuiz} 
          mistakeCount={mistakeBank.length}
          onReviewMistakes={startReviewMistakes}
        />
      )}
      {appState === "loading" && <Loading />}
      {appState === "error" && <ErrorView onRetry={() => activeConfig && startQuiz(activeConfig)} />}
      {appState === "quiz" && activeConfig && (
        <Quiz 
          questions={questions} 
          config={activeConfig} 
          onFinish={handleFinish} 
          onAnswerReport={handleAnswerReport}
        />
      )}
      {appState === "results" && <Results score={finalScore} total={questions.length} timeSpent={finalTime} onRestart={handleRestart} />}
    </>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);