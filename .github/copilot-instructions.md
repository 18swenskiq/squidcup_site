For a database call, lambdas should call the database-service-lambda, like how the add-service lambda does.

Lambdas do not need @aws-sdk dependencies in the "dependencies" section in the package.json files. AWS provides these, so they should be in the devDependencies section.

When executing powershell commands, instead of using the && operator, we should instead just pass two commands separated by a semicolon for compatibility.

When working on CDK code we do not need to manually deploy, this will be taken care of by the Github Actions pipeline.

When building the api-stack of the CDK to ensure there are no build errors, provide the --skipLibCheck flag to tsc.

When a lambda is attempting to access the database, it should call the local shared-lambda-utils package. All Lambdas thus will need SSM permissions for the DB credentials.

Types that will need to be shared between lambdas or between the backend/frontend should be stored in and used from the local types-squidcup package.

When refactoring/updating code, we should mostly focus on getting everything clean and updated to a new style, rather than supporting legacy code.

