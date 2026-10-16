output "media_bucket" {
  value       = module.media.bucket_id
  description = "MiniStack media bucket name."
}

output "topo_bucket" {
  value       = module.topo.bucket_id
  description = "MiniStack topo bucket name."
}

output "env_file" {
  value       = local_file.env_local.filename
  description = "Path of the generated .env.local."
}
