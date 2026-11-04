import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";

/** zh-CN copy, module-internal like the OpenBot screens (T07.12). */
const COPY = {
  previous: "上一页",
  next: "下一页",
  zoomOut: "缩小",
  zoomIn: "放大",
  retry: "重试",
  pdfReaderTitle: "PDF 阅读器",
  readerToolbarNote: "使用阅读器内工具栏翻页与缩放",
} as const;

import { Button, ErrorNotice, s } from "./ui";

/*
 * T07.12 (#602): the web reader rides the same minted media ticket the
 * native one does — one ≤60-second locator, refreshed by the screen, never
 * a bearer-headered storage URL. The iframe cannot set headers either, so
 * the ticket (a URL query the BFF mints) is the only admissible locator on
 * this platform too.
 */
interface PdfReaderProps {
  /** One minted ≤60-second locator for this resource (GET), or null while minting. */
  url: string | null;
  /** The refusal a failed mint answered with, surfaced as-is. */
  error?: string;
  /** Re-mint one fresh locator (the ticket window may have closed). */
  onRetry?: () => void;
  /** Legacy call sites (a local file:// source) pass nothing; a ticket needs no header. */
  token?: string;
  pageCount: number;
}
export default function PdfReader({ url, error, onRetry, pageCount }: PdfReaderProps) {
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  return (
    <View style={{ gap: 12 }}>
      <View style={[s.between, { gap: 8, flexWrap: "wrap" }]}>
        <View style={[s.row, { gap: 8 }]}>
          <Button small icon={ChevronLeft} disabled={page <= 1} onPress={() => setPage(page - 1)}>
            {COPY.previous}
          </Button>
          <Text style={s.small}>
            {page} / {pageCount}
          </Text>
          <Button
            small
            icon={ChevronRight}
            disabled={page >= pageCount}
            onPress={() => setPage(page + 1)}
          >
            {COPY.next}
          </Button>
        </View>
        <View style={[s.row, { gap: 8 }]}>
          <Button small icon={Minus} disabled={zoom <= 50} onPress={() => setZoom(zoom - 25)}>
            {COPY.zoomOut}
          </Button>
          <Text style={s.small}>{zoom}%</Text>
          <Button small icon={Plus} disabled={zoom >= 200} onPress={() => setZoom(zoom + 25)}>
            {COPY.zoomIn}
          </Button>
        </View>
      </View>
      {error ? (
        <View style={{ gap: 8 }}>
          <ErrorNotice error={error} />
          {onRetry ? (
            <Button small onPress={onRetry}>
              {COPY.retry}
            </Button>
          ) : null}
        </View>
      ) : url ? (
        <>
          <iframe
            key={`${page}:${zoom}`}
            title={COPY.pdfReaderTitle}
            src={`${url}#page=${page}&zoom=${zoom}`}
            style={{
              height: 570,
              width: "100%",
              border: 0,
              borderRadius: 12,
              background: "#e7e9e3",
            }}
          />
          <Text style={s.small}>{COPY.readerToolbarNote}</Text>
        </>
      ) : null}
    </View>
  );
}
