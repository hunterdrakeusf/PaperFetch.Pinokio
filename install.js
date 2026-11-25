module.exports = {
  run: [
    {
      when: "{{!exists('app')}}",
      method: "shell.run",
      params: {
        message: [
          "git clone https://github.com/hunterdrakeusf/PaperFetch app"
        ]
      }
    },
    {
      method: "shell.run",
      params: {
        conda: {
          path: "conda_env"
        },
        message: [
          "conda install -y -c conda-forge openjdk=21"
        ]
      }
    },
    {
      method: "shell.run",
      params: {
        conda: "conda_env",
        message: [
          "node setup.js install"
        ]
      }
    }
  ]
}
