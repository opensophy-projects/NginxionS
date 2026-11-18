// A button that opens the file chooser and hands over the chosen file (uploads of GeoIP, migration, ...): the same
// file can be chosen again right after (the input is emptied), a spinner while the upload runs.
import { type ReactNode, useRef } from "react";

export function FileButton({
	accept,
	busy,
	onFile,
	className = "btn btn-primary",
	children,
}: {
	accept: string;
	busy: boolean;
	onFile: (file: File) => void;
	className?: string;
	children: ReactNode;
}) {
	const input = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				ref={input}
				type="file"
				accept={accept}
				className="d-none"
				onChange={(e) => {
					const f = e.target.files?.[0];
					e.target.value = "";
					if (f) onFile(f);
				}}
			/>
			<button type="button" className={className} disabled={busy} onClick={() => input.current?.click()}>
				{busy && <span className="spinner-border spinner-border-sm me-2" />}
				{children}
			</button>
		</>
	);
}
