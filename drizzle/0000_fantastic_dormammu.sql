CREATE TABLE `llm_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`provider` text NOT NULL,
	`model` text,
	`system_prompt` text,
	`instructions` text,
	`api_key` text,
	`generation_config` text,
	`tools` text,
	`argument_map` text,
	`tags` text,
	`is_active` integer DEFAULT true,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text,
	`client_id` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text,
	`tool_results` text,
	`timestamp` integer NOT NULL,
	`sequence` integer,
	`parent_message_id` text,
	`is_edited` integer DEFAULT false,
	`edited_at` integer,
	`tokens` integer,
	`cost` real,
	`metadata` text,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `llm_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `thread_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`client_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	`role` text DEFAULT 'participant',
	`nickname` text,
	`metadata` text,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `llm_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`is_active` integer DEFAULT true,
	`tags` text,
	`metadata` text
);
