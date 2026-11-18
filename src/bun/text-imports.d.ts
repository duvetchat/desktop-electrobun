// Text imports (with { type: "text" }) of the scripts the Bun process runs, and of the C it compiles.
declare module "*.ps1" {
	const text: string;
	export default text;
}
declare module "*.c" {
	const text: string;
	export default text;
}
