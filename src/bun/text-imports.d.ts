// Text imports (with { type: "text" }) of the scripts the Bun process runs.
declare module "*.ps1" {
	const text: string;
	export default text;
}
