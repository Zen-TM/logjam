# The brain's switches: the one file prod's Terraform and the deploy workflows
# both read (infra/scripts/brain-setting.sh reads the one-line settings; the
# defaults in brain_variables.tf stay as they are, empty and off). Each line is
# flipped by one step of the cutover, in this order, as a one-line change that
# merges and applies like any other prod change; undoing a step is reverting
# its line. Never set these with -var or a TF_VAR_: the workflows would not see
# them. This is the only *.tfvars file in this directory (guard:
# brain_settings_are_one_file_and_read_by_the_workflows).

# The image of infra/brain/postgres. Non-empty creates the instance, its data
# volume and address, the watchdog and the drill. Required by brain_serving.
brain_pg_image_tag = ""

# True for the one apply that creates the database from nothing, on a blank
# volume with no backup in the repository; false again right after. A blank
# volume with a backup restores whatever this says.
brain_bootstrap = false

# True when the brain's API runs. Also: every task definition with a database
# (the workers and the migrate task) points at the brain, and the deploy and
# rollback workflows release to the brain instead of Elastic Beanstalk. The
# brain's API runs the same background sweeps as Elastic Beanstalk's, and they
# delete media that has no row in their own database: turned on before the
# final data copy, or with Elastic Beanstalk's sweeps still on, two APIs would
# sweep two different databases.
brain_serving = false

# True when CloudFront's API origin is the brain. Requires brain_serving; flip
# it in a later merge, once the brain answers.
brain_public = true

# t4g.micro was chosen after the rehearsal. Moving up a size (t4g.small) is
# this one line and about two minutes of downtime.
brain_instance_type = "t4g.micro"

# One entry per data volume ever made. Losing the disk adds the next key and
# makes it current; a rewind past bad data adds restore_to to the new entry (a
# time with a UTC offset). See brain_variables.tf.
brain_data_volumes = {
  "1" = { az = "ap-southeast-2a", size_gb = 20 }
}
brain_data_volume_current = "1"
