import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react-native";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import Pdf from "react-native-pdf";

/** zh-CN copy, module-internal like the OpenBot screens (T07.12). */
const COPY = {
  previous: "上一页",
  next: "下一页",
  zoomOut: "缩小",
  zoomIn: "放大",
  retry: "重试",
} as const;

import { Button, colors, ErrorNotice, s } from "./ui";

/*
 * T07.12 (#602): the native PDF reader locates its bytes through the ≤60
 * second media ticket minted online, never a storage URL with a bearer
 * header. `locate` is the screen's injected mint (details.tsx hands the
 * company-assurance client's mediaTicket); when the mint refuses — a
 * revoked session, an invisible resource — the refusal shows as the pause
 * path's own copy and NO direct-storage fallback ever runs.
 */
export interface PdfReaderProps {
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
  const ref = useRef<React.ComponentRef<typeof Pdf>>(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [pages, setPages] = useState(pageCount);
  // A render-time failure (bad bytes, interrupted pull) is the reader's own
  // state; the screen's mint refusal arrives through the `error` prop.
  const [renderError, setRenderError] = useState("");
  return (
    <View style={{ gap: 12 }}>
      <View style={[s.between, { gap: 8, flexWrap: "wrap" }]}>
        <View style={[s.row, { gap: 8 }]}>
          <Button
            small
            icon={ChevronLeft}
            disabled={page <= 1}
            onPress={() => ref.current?.setPage(page - 1)}
          >
            {COPY.previous}
          </Button>
          <Text style={s.small}>
            {page} / {pages}
          </Text>
          <Button
            small
            icon={ChevronRight}
            disabled={page >= pages}
            onPress={() => ref.current?.setPage(page + 1)}
          >
            {COPY.next}
          </Button>
        </View>
        <View style={[s.row, { gap: 8 }]}>
          <Button
            small
            icon={Minus}
            disabled={scale <= 1}
            onPress={() => setScale(Math.max(1, scale - 0.25))}
          >
            {COPY.zoomOut}
          </Button>
          <Button
            small
            icon={Plus}
            disabled={scale >= 3}
            onPress={() => setScale(Math.min(3, scale + 0.25))}
          >
            {COPY.zoomIn}
          </Button>
        </View>
      </View>
      {error || renderError ? (
        <View style={{ gap: 8 }}>
          <ErrorNotice error={error || renderError} />
          {onRetry ? (
            <Button small onPress={onRetry}>
              {COPY.retry}
            </Button>
          ) : null}
        </View>
      ) : url ? (
        <Pdf
          ref={ref}
          /* The ticket carries its own binding; no header, no storage URL. */
          source={{ uri: url, cache: false }}
          trustAllCerts={false}
          scale={scale}
          onLoadComplete={(n) => setPages(n)}
          onPageChanged={(p) => setPage(p)}
          onError={(e) => setRenderError(String(e))}
          style={{ height: 530, width: "100%", backgroundColor: colors.line, borderRadius: 12 }}
        />
      ) : null}
    </View>
  );
}
