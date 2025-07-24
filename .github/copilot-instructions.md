For a database call, lambdas should call the database-service-lambda, like how the add-service lambda does.

Lambdas do not need @aws-sdk dependencies in the "dependencies" section in the package.json files. AWS provides these, so they should be in the devDependencies section.

When executing commands, instead of using the && operator, we should instead just pass two commands separated by a semicolon for compatibility.