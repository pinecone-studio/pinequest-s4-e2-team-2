export type Cue = { start: number; en: string; mn: string }
export type Note = { id: string; time: number; text: string }
export type HistoryItem = {
  id: string
  title: string
  speaker: string
  progress: number // 0..1
  notes: number
  thumbnailUrl?: string
  durationSeconds?: number
  lastPositionMs?: number
}

// Fallbacks used only when real data is unavailable.
export const FALLBACK_DURATION = 1084 // 18:04
export const SOURCE_LINE = "МОНГОЛ ХАДМАЛ"

// Өмнө үзсэн бичлэгүүд — жинхэнэ YouTube id-тэй жишээ түүх.
// Сонгоход жинхэнэ backend (processVideo) дуудагдана.
export const HISTORY: HistoryItem[] = [
  { id: "qp0HIF3SfI4", title: "Агуу удирдагчид хэрхэн үйлдэлд уриалдаг вэ", speaker: "Саймон Синек", progress: 0.34, notes: 3 },
  { id: "iCvmsMzlF7o", title: "Сургууль бүтээлч сэтгэлгээг устгадаг уу?", speaker: "Кен Робинсон", progress: 1, notes: 7 },
  { id: "Ks-_Mh1QhMc", title: "Биеийн хэл хэн болохыг чинь тодорхойлдог", speaker: "Эми Кадди", progress: 0.72, notes: 5 },
  { id: "arj7oStGLkU", title: "Эмзэг байдлын хүч", speaker: "Брене Браун", progress: 0.18, notes: 2 },
  { id: "8jPQjjsBbIc", title: "Хойшлуулагчийн тархин дотор", speaker: "Тим Урбан", progress: 0.55, notes: 4 },
  { id: "H14bBuluwB8", title: "Тэвчээр: хүсэл тэмүүллийн хүч", speaker: "Анжела Дакуорт", progress: 0.9, notes: 6 },
]

export function thumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
}

// Эрдэмтний хариу — тэмдэглэлээс хамаарч өөрчлөгдөнө
export function buildScholarReply(notes: Note[]): string {
  if (notes.length === 0) {
    return "Найз минь, чи одоохондоо нэг ч агшинг хадгалаагүй байна. Видеогоо үзэж яваад зүрхэнд чинь хүрсэн мөчид өдөн бийрээ хөдөлгөөрэй — тэгвэл бид хамтдаа дүгнэлт хийнэ."
  }
  return "Сонсооч, найз минь — энэ хичээл бүхэлдээ ганц асуултанд багтана: «Яагаад?». Агуу удирдагчид эндээс эхэлдэг, бусад нь араас нь дагадаг. Чиний " + notes.length + " тэмдэглэл яг л зүрхэн дээр нь хүрчээ."
}
