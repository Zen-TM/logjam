output "media_bucket" {
  value       = module.media.bucket_id
  description = "LocalStack media bucket name."
}

output "topo_bucket" {
  value       = module.topo.bucket_id
  description = "LocalStack topo bucket name."
}

output "env_file" {
  value       = local_file.env_local.filename
  description = "Path of the generated .env.local."
}
