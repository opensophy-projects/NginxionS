import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EasyModal from "ez-modal-react";
import { ToastContainer } from "react-toastify";
import { AuthProvider, LocaleProvider, ThemeProvider } from "src/context";
import Router from "src/Router.tsx";

// Create a client
const queryClient = new QueryClient();

function App() {
	return (
		<LocaleProvider>
			<ThemeProvider>
				<QueryClientProvider client={queryClient}>
					<AuthProvider>
						<EasyModal.Provider>
							<Router />
						</EasyModal.Provider>
						{/* NginxionS: notifications in the bottom right corner, away from the page header */}
						<ToastContainer
							position="bottom-right"
							autoClose={5000}
							hideProgressBar={true}
							newestOnTop={true}
							closeOnClick={true}
							rtl={false}
							closeButton={false}
						/>
					</AuthProvider>
					{/* NginxionS: no React Query devtools button in the corner (phase 2) */}
				</QueryClientProvider>
			</ThemeProvider>
		</LocaleProvider>
	);
}

export default App;
